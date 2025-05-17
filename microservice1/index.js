import express from 'express';
import axios from 'axios';
import amqp from 'amqplib';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import cors from 'cors';

const MS1_PORT = parseInt(process.env.MS1_HTTP_PORT) || 3001;
const MS1_GRPC_PORT = parseInt(process.env.MS1_GRPC_PORT) || 50051;
const MS2_URL = process.env.MS2_SERVICE_URL || 'http://localhost:3002'; // Va fi http://microservice2:3002 în Docker
const RABBITMQ_URL = process.env.RABBITMQ_SERVICE_URL || 'amqp://guest:guest@localhost:5672';

const PROTO_PATH = './company_service.proto';

const app = express();
app.use(cors()); // Permite CORS dacă e necesar (ex. testare directă)
app.use(express.json());

let rabbitChannel;
let rabbitConnection;
const pendingClientFunctionRequests = {}; // Pentru a stoca promisiunile pt mesajele RabbitMQ

// --- RabbitMQ Setup ---
async function setupRabbitMQ() {
  try {
    console.log('MS1: Attempting to connect to RabbitMQ at:', RABBITMQ_URL);
    
    rabbitConnection = await amqp.connect(RABBITMQ_URL);
    console.log('MS1: Connected to RabbitMQ');
    
    rabbitConnection.on('error', (err) => {
      console.error('MS1: RabbitMQ connection error:', err);
      setTimeout(setupRabbitMQ, 5000);
    });
    
    rabbitConnection.on('close', () => {
      console.error('MS1: RabbitMQ connection closed unexpectedly');
      setTimeout(setupRabbitMQ, 5000);
    });
    
    rabbitChannel = await rabbitConnection.createChannel();
    console.log('MS1: Created RabbitMQ channel');
    
    // Asigură-te că exchange-ul există înainte de orice operațiune
    await rabbitChannel.assertExchange('details_exchange', 'topic', { durable: false });
    console.log("MS1: Exchange 'details_exchange' asserted");
    
    // Coada pentru mesajele de la MS2 despre funcția clientului
    const clientDetailsQueue = 'ms1_client_details_queue';
    await rabbitChannel.assertQueue(clientDetailsQueue, { durable: false });
    console.log(`MS1: Queue '${clientDetailsQueue}' asserted`);
    
    await rabbitChannel.bindQueue(clientDetailsQueue, 'details_exchange', 'client.details.#');
    console.log(`MS1: Queue '${clientDetailsQueue}' bound to exchange with routing key 'client.details.#'`);

    rabbitChannel.consume(clientDetailsQueue, (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log('MS1 received from RabbitMQ:', content);
          
          // Convertim numele la lowercase pentru match mai robust
          const clientName = content.name.toLowerCase();
          
          // Verifică toate cheile din pendingClientFunctionRequests (case insensitive)
          Object.keys(pendingClientFunctionRequests).forEach(key => {
            if (key.toLowerCase() === clientName) {
              console.log(`MS1: Resolving pending request for ${key} with function: ${content.functie_in_companie}`);
              pendingClientFunctionRequests[key].resolve(content.functie_in_companie);
              clearTimeout(pendingClientFunctionRequests[key].timer);
              delete pendingClientFunctionRequests[key];
            }
          });
        } catch (e) {
          console.error("MS1: Error processing RabbitMQ message:", e);
        }
        rabbitChannel.ack(msg);
      }
    });
  } catch (error) {
    console.error('MS1 RabbitMQ setup error:', error);
    // Retry connection or exit
    setTimeout(setupRabbitMQ, 5000);
  }
}

// --- gRPC Server Setup ---
function startGrpcServer() {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const companyProto = grpc.loadPackageDefinition(packageDefinition).company;

  const server = new grpc.Server();
  server.addService(companyProto.CompanyValuationService.service, {
    GetValuation: (call, callback) => {
      const companyName = call.request.name;
      console.log(`MS1 gRPC GetValuation called for: ${companyName}`);
      
      if (companyName.toLowerCase() === 'tesla') {
        // Trimite mesaj prin RabbitMQ către MS2
        if (rabbitChannel) {
          try {
            const message = { name: companyName, numar_de_angajati: "25,000" };
            rabbitChannel.publish('details_exchange', 'company.details.tesla', Buffer.from(JSON.stringify(message)));
            console.log('MS1 sent to RabbitMQ (for MS2):', message);
          } catch (err) {
            console.error('MS1: Error sending message to RabbitMQ:', err);
          }
        }
        callback(null, { valoare_estimata: '$USD 70,000,000' });
      } else {
        callback({
          code: grpc.status.NOT_FOUND,
          details: 'Company not found for valuation',
        });
      }
    },
  });

  server.bindAsync(`0.0.0.0:${MS1_GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error(`MS1 gRPC server error on port ${MS1_GRPC_PORT}:`, err);
      return;
    }
    console.log(`MS1 gRPC server running at http://0.0.0.0:${port}`);
    server.start();
  });
}

// --- HTTP Endpoints ---
// Endpoint pentru API Gateway (Scenario 1)
app.post('/customers', async (req, res) => {
  try {
    console.log('MS1: Received POST request to /customers with body:', req.body);
    const clientName = req.body.name;
    
    if (!clientName) {
      console.log('MS1: Missing client name in request');
      return res.status(400).json({ message: "Client name is required in body" });
    }

    if (clientName.toLowerCase() !== 'elon musk') {
      console.log(`MS1: Client ${clientName} not found.`);
      return res.status(200).json({
        found: false,
        message: 'Nu s-a găsit niciun rezultat în baza de date.',
        details: `Client '${clientName}' not found. Only 'Elon Musk' is known.`
      });
    }

    // 1. Cere "Avere detinuta" de la MS2 prin REST
    console.log(`MS1: Calling MS2 for wealth of ${clientName}`);
    const wealthResponse = await axios.get(`${MS2_URL}/internal/client-wealth/${encodeURIComponent(clientName)}`);
    const avereDetinuta = wealthResponse.data.avere_detinuta;
    console.log(`MS1: Received wealth from MS2: ${avereDetinuta}`);

    // 2. Așteaptă "Functie in companie" de la MS2 prin RabbitMQ
    const functiePromise = new Promise((resolve, reject) => {
      // Setează un timeout pentru a nu aștepta la infinit
      const timer = setTimeout(() => {
        console.log(`MS1: Timeout waiting for function data for ${clientName}`);
        delete pendingClientFunctionRequests[clientName];
        // În loc să respingem promisiunea, putem trimite o valoare default pentru a nu opri flow-ul
        resolve('Unknown Position'); 
      }, 10000); // 10 secunde timeout

      pendingClientFunctionRequests[clientName] = { resolve, reject, timer };
      console.log(`MS1: Created pending request for ${clientName}`);
    });
    
    const functieInCompanie = await functiePromise;
    console.log(`MS1: Function resolved to: ${functieInCompanie}`);

    res.json({
      name: clientName,
      type: "Client",
      avere_detinuta: avereDetinuta,
      functie_in_companie: functieInCompanie,
    });

  } catch (error) {
    console.error(`MS1 error processing request:`, error.message);
    if (error.response) console.error("MS1 Error details:", error.response.data);
    res.status(500).json({ message: 'Error processing request in MS1', error: error.message });
  }
});

// Add a GET check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'MS1 is healthy' });
});

app.listen(MS1_PORT, async () => {
  console.log(`Microservice 1 (HTTP) listening on port ${MS1_PORT}`);
  await setupRabbitMQ();
  startGrpcServer();
});
