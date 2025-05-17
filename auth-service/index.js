import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const app = express();
const PORT = 4500;
const JWT_SECRET = '123'; // în realitate, folosește .env!

app.use(cors());
app.use(express.json());

const users = []; // Simulăm o "bază de date" în memorie

// Register
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const existing = users.find(u => u.username === username);
  if (existing) {
    return res.status(409).json({ message: 'User already exists' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ username, password: hashedPassword });
    console.log('User registered:', username);
    console.log('Current users:', users);
    res.status(201).json({ message: 'Registered successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Error registering user' });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const user = users.find(u => u.username === username);
  if (!user) {
    console.log('Login attempt failed: User not found', username);
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  try {
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      console.log('Login attempt failed: Invalid password for user', username);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
    console.log('User logged in:', username);
    res.json({ token, username });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Error logging in' });
  }
});

// Protected route
app.get('/profile', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Missing token' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });

    res.json({ message: `Welcome ${decoded.username}` });
  });
});

app.listen(PORT, () => {
  console.log(`Auth service running on http://localhost:${PORT}`);
});
