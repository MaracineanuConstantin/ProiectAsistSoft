import express from 'express';
import amqp from 'amqplib';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import cors from 'cors';

const MS2_PORT = parseInt(process.env.MS2_HTTP_PORT) || 3002;
const MS1_GRPC_URL = process.env.MS1_GRPC_SERVICE_ADDRESS || 'localhost:50051';
const RABBITMQ_URL = process.env.RABBITMQ_SERVICE_URL || 'amqp://guest:guest@localhost:5672';

const PROTO_PATH = './company_service.proto'; 

const app = express();
app.use(cors());
app.use(express.json());

let rabbitChannel;
let rabbitConnection;
let grpcClient;
const pendingCompanyEmployeeRequests = {};

// --- RabbitMQ Setup ---
async function setupRabbitMQ() {
  try {
    console.log('MS2: Attempting to connect to RabbitMQ at:', RABBITMQ_URL);
    
    rabbitConnection = await amqp.connect(RABBITMQ_URL);
    console.log('MS2: Connected to RabbitMQ');
    
    rabbitConnection.on('error', (err) => {
      console.error('MS2: RabbitMQ connection error:', err);
      setTimeout(setupRabbitMQ, 5000);
    });
    
    rabbitConnection.on('close', () => {
      console.error('MS2: RabbitMQ connection closed unexpectedly');
      setTimeout(setupRabbitMQ, 5000);
    });
    
    rabbitChannel = await rabbitConnection.createChannel();
    console.log('MS2: Created RabbitMQ channel');
    
    await rabbitChannel.assertExchange('details_exchange', 'topic', { durable: false });
    console.log("MS2: Exchange 'details_exchange' asserted");
    
    const companyDetailsQueue = 'ms2_company_details_queue';
    await rabbitChannel.assertQueue(companyDetailsQueue, { durable: false });
    console.log(`MS2: Queue '${companyDetailsQueue}' asserted`);
    
    await rabbitChannel.bindQueue(companyDetailsQueue, 'details_exchange', 'company.details.#');
    console.log(`MS2: Queue '${companyDetailsQueue}' bound to exchange with routing key 'company.details.#'`);

    rabbitChannel.consume(companyDetailsQueue, (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log('MS2 received from RabbitMQ:', content);
          
          const companyName = content.name.toLowerCase();
          
          Object.keys(pendingCompanyEmployeeRequests).forEach(key => {
            if (key.toLowerCase() === companyName) {
              console.log(`MS2: Resolving pending request for ${key} with employees: ${content.numar_de_angajati}`);
              pendingCompanyEmployeeRequests[key].resolve(content.numar_de_angajati);
              clearTimeout(pendingCompanyEmployeeRequests[key].timer);
              delete pendingCompanyEmployeeRequests[key];
            }
          });
        } catch (e) {
          console.error("MS2: Error processing RabbitMQ message:", e);
        }
        rabbitChannel.ack(msg);
      }
    });
  } catch (error) {
    console.error('MS2 RabbitMQ setup error:', error);
    setTimeout(setupRabbitMQ, 5000);
  }
}

// --- gRPC Client Setup ---
function setupGrpcClient() {
  try {
    console.log(`MS2: Setting up gRPC client to connect to MS1 at ${MS1_GRPC_URL}`);
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const companyProto = grpc.loadPackageDefinition(packageDefinition).company;
    grpcClient = new companyProto.CompanyValuationService(MS1_GRPC_URL, grpc.credentials.createInsecure());
    console.log('MS2 gRPC client setup for MS1 completed');
  } catch (error) {
    console.error('MS2: Error setting up gRPC client:', error);
    setTimeout(setupGrpcClient, 5000);
  }
}

// --- HTTP Endpoints ---

// Endpoint intern pentru MS1 (Scenario 1, pasul 3)
app.get('/internal/client-wealth/:name', (req, res) => {
  const clientName = req.params.name;
  console.log(`MS2 /internal/client-wealth GET for: ${clientName}`);

  if (clientName.toLowerCase() === 'elon musk') {
    res.json({ avere_detinuta: '$USD 10,000,000' });
    
    // Trimite "Functie in companie" prin RabbitMQ către MS1 (Scenario 1, pasul 4)
    if (rabbitChannel) {
      try {
        const message = { name: clientName, functie_in_companie: 'CEO' };
        rabbitChannel.publish('details_exchange', 'client.details.elonmusk', Buffer.from(JSON.stringify(message)));
        console.log('MS2 sent to RabbitMQ (for MS1):', message);
      } catch (err) {
        console.error("MS2: Error publishing client function message:", err);
      }
    } else {
      console.error("MS2: RabbitMQ channel not available when trying to send client function");
    }
  } else {
    res.status(404).json({ message: 'Client wealth information not found' });
  }
});

// Endpoint pentru API Gateway (Scenario 2)
app.post('/companies', async (req, res) => {
  try {
    console.log('MS2: Received POST request to /companies with body:', req.body);
    const companyName = req.body.name;
    
    if (!companyName) {
      console.log('MS2: Missing company name in request');
      return res.status(400).json({ message: "Company name is required in body" });
    }

    if (companyName.toLowerCase() !== 'tesla') {
      console.log(`MS2: Company ${companyName} not found.`);
      return res.status(200).json({
        found: false,
        message: 'Nu s-a găsit niciun rezultat în baza de date.',
        details: `Company '${companyName}' not found. Only 'Tesla' is known.`
      });
    }

    if (!grpcClient) {
      console.log('MS2: gRPC client not initialized, trying to set up again');
      setupGrpcClient();
      if (!grpcClient) {
        return res.status(500).json({ message: 'MS2: gRPC client not available' });
      }
    }

    // 1. Cere "Valoare estimata" de la MS1 prin gRPC
    console.log(`MS2: Calling MS1 gRPC for valuation of ${companyName}`);
    const valuationResponse = await new Promise((resolve, reject) => {
      grpcClient.GetValuation({ name: companyName }, (err, response) => {
        if (err) {
          console.error('MS2 gRPC call to MS1 error:', err);
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
    const valoareEstimata = valuationResponse.valoare_estimata;
    console.log(`MS2: Received valuation from MS1 gRPC: ${valoareEstimata}`);

    // 2. Așteaptă "Numar de angajati" de la MS1 prin RabbitMQ
    const angajatiPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        console.log(`MS2: Timeout waiting for employee data for ${companyName}`);
        delete pendingCompanyEmployeeRequests[companyName];
        resolve('Unknown');
      }, 10000); // 10 secunde timeout

      pendingCompanyEmployeeRequests[companyName] = { resolve, reject, timer };
      console.log(`MS2: Created pending request for ${companyName} employees`);
    });

    const numarAngajati = await angajatiPromise;
    console.log(`MS2: Employee count resolved to: ${numarAngajati}`);

    res.json({
      name: companyName,
      type: "Companie",
      valoare_estimata: valoareEstimata,
      numar_de_angajati: numarAngajati,
    });
  } catch (error) {
    console.error(`MS2 error processing request:`, error.message || error);
    res.status(500).json({ message: 'Error processing request in MS2', error: error.message || error });
  }
});

// Add a GET check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'MS2 is healthy' });
});

app.listen(MS2_PORT, async () => {
  console.log(`Microservice 2 (HTTP) listening on port ${MS2_PORT}`);
  await setupRabbitMQ();
  setupGrpcClient();
});
