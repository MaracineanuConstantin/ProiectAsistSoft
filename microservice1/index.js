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
const pendingClientFunctionRequests = {}; // Pentru a stoca promisiunile pt mesajele RabbitMQ

// --- RabbitMQ Setup ---
async function setupRabbitMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    rabbitChannel = await connection.createChannel();
    console.log('MS1 connected to RabbitMQ');

    // Coada pentru mesajele de la MS2 despre funcția clientului
    const clientDetailsQueue = 'ms1_client_details_queue';
    await rabbitChannel.assertQueue(clientDetailsQueue, { durable: false });
    await rabbitChannel.bindQueue(clientDetailsQueue, 'details_exchange', 'client.details.#'); // Ascultă toate detaliile client

    rabbitChannel.consume(clientDetailsQueue, (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log('MS1 received from RabbitMQ:', content);
          if (content.name && pendingClientFunctionRequests[content.name]) {
            pendingClientFunctionRequests[content.name].resolve(content.functie_in_companie);
            clearTimeout(pendingClientFunctionRequests[content.name].timer);
            delete pendingClientFunctionRequests[content.name];
          }
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
          const message = { name: companyName, numar_de_angajati: "25,000" };
          rabbitChannel.publish('details_exchange', 'company.details.tesla', Buffer.from(JSON.stringify(message)));
          console.log('MS1 sent to RabbitMQ (for MS2):', message);
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
  console.log(`MS1 gRPC server running at http://0.0.0.0:${port}`); // port va fi MS1_GRPC_PORT
  server.start();
});
}

// --- HTTP Endpoints ---
// Endpoint pentru API Gateway (Scenario 1)
app.post('/customers', async (req, res) => {
  const clientName = req.body.name;
  console.log(`MS1 /customers POST request for: ${clientName}`);

  if (!clientName) {
        return res.status(400).json({ message: "Client name is required in body" });
  }

  if (clientName.toLowerCase() !== 'elon musk') {
    console.log(`MS1: Client ${clientName} not found.`);
    return res.status(404).json({
      found: false,
      message: 'Nu s-a găsit niciun rezultat în baza de date.',
      details: `Client '${clientName}' not found. Only 'Elon Musk' is known.`
    });
  }

  try {
    // 1. Cere "Avere detinuta" de la MS2 prin REST
    console.log(`MS1: Calling MS2 for wealth of ${clientName}`);
    const wealthResponse = await axios.get(`${MS2_URL}/internal/client-wealth/${encodeURIComponent(clientName)}`);
    const avereDetinuta = wealthResponse.data.avere_detinuta;
    console.log(`MS1: Received wealth from MS2: ${avereDetinuta}`);

    // 2. Așteaptă "Functie in companie" de la MS2 prin RabbitMQ
    const functiePromise = new Promise((resolve, reject) => {
        // Setează un timeout pentru a nu aștepta la infinit
        const timer = setTimeout(() => {
            delete pendingClientFunctionRequests[clientName];
            reject(new Error('Timeout waiting for client function from RabbitMQ'));
        }, 10000); // 10 secunde timeout

        pendingClientFunctionRequests[clientName] = { resolve, reject, timer };
    });
    
    // MS2 ar trebui să trimită mesajul după ce răspunde la apelul REST
    // Acest lucru este coordonat prin faptul că MS2 trimite mesajul după ce a răspuns cererii REST initiate de MS1.

    const functieInCompanie = await functiePromise;
    console.log(`MS1: Received function via RabbitMQ: ${functieInCompanie}`);

    res.json({
      name: clientName,
      type: "Client", // Adăugat pentru a se potrivi cu formatul din frontend
      avere_detinuta: avereDetinuta,
      functie_in_companie: functieInCompanie,
    });

  } catch (error) {
    console.error(`MS1 error processing client ${clientName}:`, error.message);
    if (error.response) console.error("MS1 Error details:", error.response.data);
    res.status(500).json({ message: 'Error getting client details from MS1', error: error.message });
  }
});

app.listen(MS1_PORT, async () => {
  console.log(`Microservice 1 (HTTP) listening on port ${MS1_PORT}`);
  await setupRabbitMQ();
  startGrpcServer();

  // Asigură-te că exchange-ul există în RabbitMQ înainte de a publica/consuma
  // Acest lucru este mai robust dacă este făcut de publisher, dar și consumerul îl poate declara
  if (rabbitChannel) {
    try {
        await rabbitChannel.assertExchange('details_exchange', 'topic', { durable: false });
        console.log("MS1: Exchange 'details_exchange' asserted.");
    } catch (err) {
        console.error("MS1: Failed to assert exchange 'details_exchange'.", err);
    }
  }
});