import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import jwt from 'jsonwebtoken';

const app = express();
app.use(cors({
    origin: 'http://localhost:3000', // Your Svelte app's port
    credentials: true
}));
app.use(express.json());

const PORT = parseInt(process.env.API_GATEWAY_PORT) || 8000;
const JWT_SECRET = '123';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    console.log('Gateway: No token provided');
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Gateway: Invalid token', err.message);
      return res.status(403).json({ message: 'Access denied. Invalid token.' });
    }
    req.user = user;
    console.log('Gateway: Token validated for user:', user.username);
    next();
  });
}

app.get('/', (req, res) => {
  res.send('API Gateway funcționează (simplified auth)');
});

// Process search requests
app.post('/search', authenticateToken, (req, res) => {
    const { type, name } = req.body;
    console.log('Gateway: /search hit with body:', req.body);
    
    if (!type || !name) {
        return res.status(400).json({ message: "Type and name are required in POST body for /search." });
    }
    
    if (type !== 'Client' && type !== 'Companie') {
        return res.status(400).json({ message: "Invalid search type. Must be 'Client' or 'Companie'." });
    }
    
    // Forward to appropriate microservice
    const ms1ServiceUrl = process.env.MS1_SERVICE_URL || 'http://localhost:3001';
    const ms2ServiceUrl = process.env.MS2_SERVICE_URL || 'http://localhost:3002';
    
    let targetUrl;
    let endpoint;
    
    if (type === 'Client') {
        console.log('Gateway: Routing to MS1 for Client search');
        targetUrl = `${ms1ServiceUrl}/customers`;
        endpoint = '/customers';
    } else if (type === 'Companie') {
        console.log('Gateway: Routing to MS2 for Company search');
        targetUrl = `${ms2ServiceUrl}/companies`;
        endpoint = '/companies';
    }
    
    // Forward the request
    console.log(`Gateway: Forwarding to ${targetUrl}`);
    
    // Using fetch instead of a proxy middleware for more direct control
    fetch(targetUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': req.headers.authorization
        },
        body: JSON.stringify(req.body)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Gateway: Received response from ${endpoint}:`, data);
        res.json(data);
    })
    .catch(error => {
        console.error(`Gateway: Error forwarding to ${endpoint}:`, error);
        res.status(500).json({ 
            message: `Error forwarding request to ${type} service`,
            error: error.message
        });
    });
});

app.listen(PORT, () => {
  console.log(`API Gateway is running at http://localhost:${PORT}`);
});
