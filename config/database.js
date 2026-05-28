const { PrismaClient } = require('@prisma/client');
const EventEmitter = require('events');
require('dotenv').config();

// Create Prisma Client instance with logging
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? ['error', 'warn']
    : ['error'],
  errorFormat: 'pretty',
});

// Session store for Express - MUST extend EventEmitter
class PrismaSessionStore extends EventEmitter {
  constructor(prismaClient) {
    super(); // IMPORTANT: Call EventEmitter constructor
    this.prisma = prismaClient;
    
    // Emit connect event (express-session expects this)
    process.nextTick(() => {
      this.emit('connect');
    });
  }

  // Express session expects callback-based methods
  get(sid, callback) {
    this.prisma.session.findUnique({ where: { sid } })
      .then(session => {
        if (!session) {
          return callback(null, null);
        }
        
        // Check if session has expired
        if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
          this.destroy(sid, () => callback(null, null));
          return;
        }
        
        try {
          const data = JSON.parse(session.data);
          callback(null, data);
        } catch (err) {
          callback(err);
        }
      })
      .catch(err => {
        console.error('Session get error:', err);
        callback(err);
      });
  }

  set(sid, session, callback) {
    const ttl = session.cookie?.maxAge ? session.cookie.maxAge / 1000 : 86400;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    
    this.prisma.session.upsert({
      where: { sid },
      update: {
        data: JSON.stringify(session),
        expiresAt,
      },
      create: {
        sid,
        data: JSON.stringify(session),
        expiresAt,
      },
    })
      .then(() => callback(null))
      .catch(err => {
        console.error('Session set error:', err);
        callback(err);
      });
  }

  destroy(sid, callback) {
    this.prisma.session.deleteMany({ where: { sid } })
      .then(() => callback(null))
      .catch(err => {
        console.error('Session destroy error:', err);
        callback(err);
      });
  }

  touch(sid, session, callback) {
    const ttl = session.cookie?.maxAge ? session.cookie.maxAge / 1000 : 86400;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    
    this.prisma.session.update({
      where: { sid },
      data: { expiresAt }
    })
      .then(() => callback(null))
      .catch(() => callback(null)); // Ignore if session doesn't exist
  }

  // ADD THIS METHOD - Required by express-session
  createSession(sid, session, callback) {
    this.set(sid, session, callback);
  }

  // Required by express-session
  on(event, listener) {
    return super.on(event, listener);
  }
}

// Database connection function
async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log('✅ PostgreSQL (Neon) Connected Successfully');
    
    // Test connection and get version
    const result = await prisma.$queryRaw`SELECT version()`;
    console.log('📊 PostgreSQL Version:', result[0].version.split(',')[0]);
    
    return true;
  } catch (error) {
    console.error('❌ PostgreSQL Connection Error:', error.message);
    process.exit(1);
  }
}

// Helper to check connection status
async function isConnected() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// Helper to disconnect gracefully
async function disconnectDatabase() {
  await prisma.$disconnect();
  console.log('🔌 PostgreSQL Disconnected');
}

// Export everything
module.exports = {
  prisma,
  connectDatabase,
  disconnectDatabase,
  PrismaSessionStore,
  isConnected,
};