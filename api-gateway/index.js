import express from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
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

const searchProxy = createProxyMiddleware({
    router: (req) => {

      const ms1ServiceUrl = process.env.MS1_SERVICE_URL || 'http://localhost:3001';
      const ms2ServiceUrl = process.env.MS2_SERVICE_URL || 'http://localhost:3002';
      // req.body este populat de express.json()
      if (req.body && req.body.type === 'Client') {
          console.log('Gateway: Routing to MS1 for Client search');
          return ms1ServiceUrl;
      }
      if (req.body && req.body.type === 'Companie') {
          console.log('Gateway: Routing to MS2 for Company search');
          return ms2ServiceUrl;
      }
      console.log('Gateway: No route match for search type:', req.body.type);
        return null; // Important: returnează null dacă nu se potrivește nicio rută
    },
    pathRewrite: (path, req) => {
        // Path-ul original este /search
        let newPath = path;
        if (req.body && req.body.type === 'Client') {
            newPath = '/customers'; // Noul path pentru MS1
            console.log(`Gateway: Rewriting path for Client to ${newPath}`);
        } else if (req.body && req.body.type === 'Companie') {
            newPath = '/companies'; // Noul path pentru MS2
            console.log(`Gateway: Rewriting path for Company to ${newPath}`);
        }
        return newPath;
    },
    changeOrigin: true,
    onProxyReq: fixRequestBody, // Important pentru a re-stream-ui body-ul după ce express.json l-a consumat
    onError: (err, req, res) => {
        console.error('Gateway: Proxy error:', err);
        if (!res.headersSent) {
             res.status(500).json({ message: 'Proxy error', details: err.message });
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`Gateway: Received response from upstream for ${req.method} ${req.originalUrl}, status: ${proxyRes.statusCode}`);
    }
});


app.post('/search', authenticateToken, (req, res, next) => {
    const { type, name } = req.body;
    console.log('Gateway: /search hit with body:', req.body);
    if (!type || !name) {
        return res.status(400).json({ message: "Type and name are required in POST body for /search." });
    }
    if (type !== 'Client' && type !== 'Companie') {
        return res.status(400).json({ message: "Invalid search type. Must be 'Client' or 'Companie'." });
    }
    // Dacă validarea trece, continuă la middleware-ul de proxy
    searchProxy(req, res, next);
});

app.listen(PORT, () => {
  console.log(`API Gateway is running at http://localhost:${PORT}`);
});