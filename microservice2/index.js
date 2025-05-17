import express from 'express';
import amqp from 'amqplib';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import cors from 'cors';

const MS2_PORT = parseInt(process.env.MS2_HTTP_PORT) || 3002;
const MS1_GRPC_URL = process.env.MS1_GRPC_SERVICE_ADDRESS || 'localhost:50051'; // Va fi microservice1:50051 în Docker
const RABBITMQ_URL = process.env.RABBITMQ_SERVICE_URL || 'amqp://guest:guest@localhost:5672';

const PROTO_PATH = './company_service.proto'; // Copie a definiției proto

const app = express();
app.use(cors());
app.use(express.json());

let rabbitChannel;
let grpcClient;
const pendingCompanyEmployeeRequests = {}; // Pentru a stoca promisiunile pt mesajele RabbitMQ

// --- RabbitMQ Setup ---
async function setupRabbitMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    rabbitChannel = await connection.createChannel();
    console.log('MS2 connected to RabbitMQ');

    // Coada pentru mesajele de la MS1 despre numărul de angajați
    const companyDetailsQueue = 'ms2_company_details_queue';
    await rabbitChannel.assertQueue(companyDetailsQueue, { durable: false });
    // Asigură-te că exchange-ul există înainte de a lega coada
    await rabbitChannel.assertExchange('details_exchange', 'topic', { durable: false });
    await rabbitChannel.bindQueue(companyDetailsQueue, 'details_exchange', 'company.details.#'); // Ascultă toate detaliile companiei

    rabbitChannel.consume(companyDetailsQueue, (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log('MS2 received from RabbitMQ:', content);
          if (content.name && pendingCompanyEmployeeRequests[content.name]) {
            pendingCompanyEmployeeRequests[content.name].resolve(content.numar_de_angajati);
            clearTimeout(pendingCompanyEmployeeRequests[content.name].timer);
            delete pendingCompanyEmployeeRequests[content.name];
          }
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
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const companyProto = grpc.loadPackageDefinition(packageDefinition).company;
  grpcClient = new companyProto.CompanyValuationService(MS1_GRPC_URL, grpc.credentials.createInsecure());
  console.log('MS2 gRPC client setup for MS1');
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
      const message = { name: clientName, functie_in_companie: 'CEO' };
      // Asigură-te că exchange-ul există. Publisher-ul ar trebui să-l declare.
      rabbitChannel.assertExchange('details_exchange', 'topic', { durable: false })
        .then(() => {
            rabbitChannel.publish('details_exchange', 'client.details.elonmusk', Buffer.from(JSON.stringify(message)));
            console.log('MS2 sent to RabbitMQ (for MS1):', message);
        })
        .catch(err => console.error("MS2: Error asserting exchange before publish:", err));
    }
  } else {
    res.status(404).json({ message: 'Client wealth information not found' });
  }
});

// Endpoint pentru API Gateway (Scenario 2)
app.post('/companies', async (req, res) => {
  const companyName = req.body.name;
  console.log(`MS2 /companies POST request for: ${companyName}`);

  if (!companyName) {
    return res.status(400).json({ message: "Company name is required in body" });
  }

  if (companyName.toLowerCase() !== 'tesla') {
    console.log(`MS2: Company ${companyName} not found.`);
    return res.status(404).json({
      found: false,
      message: 'Nu s-a găsit niciun rezultat în baza de date.',
      details: `Company '${companyName}' not found. Only 'Tesla' is known.`
    });
  }

  try {
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
            delete pendingCompanyEmployeeRequests[companyName];
            reject(new Error('Timeout waiting for company employee count from RabbitMQ'));
        }, 10000); // 10 secunde timeout

        pendingCompanyEmployeeRequests[companyName] = { resolve, reject, timer };
    });

    // MS1 ar trebui să trimită mesajul după ce răspunde la apelul gRPC

    const numarAngajati = await angajatiPromise;
    console.log(`MS2: Received employee count via RabbitMQ: ${numarAngajati}`);

    res.json({
      name: companyName,
      type: "Companie", // Adăugat pentru a se potrivi cu formatul din frontend
      valoare_estimata: valoareEstimata,
      numar_de_angajati: numarAngajati,
    });

  } catch (error) {
    console.error(`MS2 error processing company ${companyName}:`, error.message || error);
    res.status(500).json({ message: 'Error getting company details from MS2', error: error.message || error });
  }
});

app.listen(MS2_PORT, async () => {
  console.log(`Microservice 2 (HTTP) listening on port ${MS2_PORT}`);
  await setupRabbitMQ();
  setupGrpcClient();
});