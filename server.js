const express = require("express");
const multer = require("multer");
const path = require("path");
const hbs = require("hbs");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs").promises;
const compression = require("compression");
const crypto = require("crypto");
require("dotenv").config();

// PostgreSQL session store
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

// Database imports - PostgreSQL with Prisma
const { prisma, connectDatabase } = require("./config/database");

const app = express();

// ================== TRUST PROXY (for Render/Neon) ==================
app.set("trust proxy", 1);

// ================== COMPRESSION MIDDLEWARE ==================
app.use(compression());

// ================== SESSION MIDDLEWARE with PostgreSQL ==================
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const sessionConfig = {
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    store: new pgSession({
      pool: pgPool,
      tableName: 'session',  // Change from 'sessions' to 'session'
      createTableIfMissing: true,
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
    },
};

app.use(session(sessionConfig));

// ================== BODY PARSERS ==================
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// ================== STATIC FILES ==================
app.use(express.static(path.join(__dirname, "public"), {
    maxAge: process.env.NODE_ENV === "production" ? "30d" : 0,
    etag: true,
}));

// Create uploads directory if it doesn't exist (skip on Vercel)
const uploadDir = path.join(__dirname, "uploads");
const avatarDir = path.join(__dirname, "public/uploads/avatars");

async function ensureDirectories() {
    // Skip directory creation on Vercel (read-only filesystem)
    const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
    
    if (isVercel) {
        console.log("⚠️ Running on Vercel/Production - skipping directory creation (read-only filesystem)");
        console.log("ℹ️ File uploads will be disabled. Use cloud storage for production.");
        return;
    }
    
    try {
        // Only create directories in development/local environment
        await fs.mkdir(uploadDir, { recursive: true });
        await fs.mkdir(avatarDir, { recursive: true });
        console.log("✅ Upload directories created/verified");
    } catch (err) {
        console.error("❌ Error creating directories:", err);
    }
}
ensureDirectories();

// ================== MULTER SETUP ==================

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + "-" + Date.now() + ext);
    },
});

const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "public/uploads/avatars/"),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, "avatar-" + req.session.userId + "-" + Date.now() + ext);
    },
});

const imageFilter = (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    allowedTypes.includes(file.mimetype)
        ? cb(null, true)
        : cb(new Error("Invalid file type. Only JPEG, PNG, GIF, and WEBP are allowed."));
};

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter });
const uploadMultiple = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }).array("attachments", 5);

// ================== HANDLEBARS SETUP ==================

app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "pages"));

try {
    hbs.registerPartials(path.join(__dirname, "pages/partials"));
} catch (err) {
    console.log("⚠️ No partials directory found, continuing...");
}

hbs.registerHelper("ifEquals", function (a, b, options) {
    const result = a == b;
    if (!options || typeof options.fn !== "function") return result;
    return result ? options.fn(this) : options.inverse(this);
});

hbs.registerHelper("ifNotEquals", function (a, b, options) {
    const result = a != b;
    if (!options || typeof options.fn !== "function") return result;
    return result ? options.fn(this) : options.inverse(this);
});

hbs.registerHelper("eq", function (a, b, options) {
    const result = a === b;
    if (!options || typeof options.fn !== "function") return result;
    return result ? options.fn(this) : options.inverse(this);
});

hbs.registerHelper("ne", function (a, b, options) {
    const result = a !== b;
    if (!options || typeof options.fn !== "function") return result;
    return result ? options.fn(this) : options.inverse(this);
});

hbs.registerHelper("formatDate", function (date) {
    if (!date) return "";
    return new Date(date).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
});

hbs.registerHelper("formatTime", function (date) {
    if (!date) return "";
    return new Date(date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
});

hbs.registerHelper("formatZone", function (zone) {
    const zones = {
        main_gate: "Main Gate", hostels: "Hostels", academic: "Academic",
        perimeter: "Perimeter", parking: "Parking", admin: "Admin",
    };
    return zones[zone] || zone;
});

hbs.registerHelper("formatStatus", function (status) {
    const map = {
        scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed",
        missed: "Missed", cancelled: "Cancelled", reported: "Reported",
        acknowledged: "Acknowledged", investigating: "Investigating",
        resolved: "Resolved", closed: "Closed",
    };
    return map[status] || status;
});

hbs.registerHelper("formatSeverity", function (severity) {
    return severity ? severity.charAt(0).toUpperCase() + severity.slice(1) : "Medium";
});

hbs.registerHelper("json", function (ctx) { return JSON.stringify(ctx); });

hbs.registerHelper("inc", function (v) { return (parseInt(v) || 0) + 1; });

hbs.registerHelper("math", function (l, op, r) {
    l = parseFloat(l); r = parseFloat(r);
    return { "+": l + r, "-": l - r, "*": l * r, "/": r !== 0 ? l / r : 0, "%": l % r }[op];
});

hbs.registerHelper("truncate", function (text, len) {
    if (!text) return "";
    text = String(text);
    return text.length <= len ? text : text.substring(0, len) + "...";
});

hbs.registerHelper("or", function () {
    return Array.from(arguments).slice(0, -1).some(Boolean);
});

hbs.registerHelper("and", function () {
    return Array.from(arguments).slice(0, -1).every(Boolean);
});

hbs.registerHelper("formatRole", function (role) {
    if (!role) return "";
    return typeof role === "string" ? role.charAt(0).toUpperCase() + role.slice(1) : String(role);
});

// ================== UTILITY FUNCTIONS ==================

function formatRelativeTime(date) {
    if (!date) return "Just now";
    const diff = Date.now() - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    return "Just now";
}

function getInitials(name) {
    if (!name) return "U";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2);
}

function isValidUrl(string) {
    try { new URL(string); return true; } catch (_) { return false; }
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    return /^\+?[1-9]\d{1,14}$/.test(phone.replace(/[\s\-\(\)]/g, ""));
}

function maskApiKey(key) {
    if (!key || key.length <= 8) return "****";
    return key.substring(0, 4) + "..." + key.substring(key.length - 4);
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function generateApiKey() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let key = "cg_";
    for (let i = 0; i < 32; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
    return key;
}

function hashApiKey(key) { return Buffer.from(key).toString("base64"); }

function generateTwoFactorSecret() { return "2FA_SECRET_" + Math.random().toString(36).substring(2, 15); }

function parseUserAgent(userAgent) {
    let browser = "Unknown", os = "Unknown";
    if (userAgent.includes("Chrome")) browser = "Chrome";
    else if (userAgent.includes("Firefox")) browser = "Firefox";
    else if (userAgent.includes("Safari")) browser = "Safari";
    else if (userAgent.includes("Edge")) browser = "Edge";
    if (userAgent.includes("Windows")) os = "Windows";
    else if (userAgent.includes("Mac")) os = "macOS";
    else if (userAgent.includes("Linux")) os = "Linux";
    else if (userAgent.includes("Android")) os = "Android";
    else if (userAgent.includes("iOS")) os = "iOS";
    return { browser, os };
}

function getDeviceIcon(os) {
    const icons = {
        Windows: "fa-windows", macOS: "fa-apple", Linux: "fa-linux",
        Android: "fa-android", iOS: "fa-apple"
    };
    return icons[os] || "fa-laptop";
}

function calculateAverageDuration(patrols) {
    let total = 0, count = 0;
    patrols.forEach((p) => {
        if (p.startTime && p.endTime) { 
            total += (new Date(p.endTime) - new Date(p.startTime)) / 60000; 
            count++; 
        }
    });
    return count > 0 ? Math.round(total / count) : 0;
}

// ================== PRISMA HELPER FUNCTIONS (replacing MongoDB) ==================

// User helpers
async function getUserById(id) {
    try {
        return await prisma.user.findUnique({
            where: { id },
            select: {
                id: true, 
                firstName: true, 
                lastName: true, 
                name: true, 
                email: true,
                password: true, 
                role: true, 
                badgeNumber: true, 
                phoneNumber: true,
                institution: true, 
                profileImage: true, 
                isActive: true, 
                lastLogin: true,
                createdAt: true, 
                updatedAt: true, 
                timezone: true, 
                notificationSettings: true,
                privacySettings: true,
                accessibilitySettings: true,
                integrationSettings: true,
                twoFactorEnabled: true,
                loginAlerts: true, 
                passwordLastChanged: true, 
                emergencyContact: true,
                shiftPreferences: true
            }
        });
    } catch (error) {
        console.error("Get user by ID error:", error);
        return null;
    }
}

async function getUserByEmail(email) {
    try {
        return await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                name: true,
                email: true,
                password: true,
                role: true,
                badgeNumber: true,
                phoneNumber: true,
                institution: true,
                profileImage: true,
                isActive: true,
                lastLogin: true,
                createdAt: true,
                notificationSettings: true,
                privacySettings: true,
                accessibilitySettings: true,
                integrationSettings: true,
                twoFactorEnabled: true,
                loginAlerts: true
            }
        });
    } catch (error) {
        console.error("Get user by email error:", error);
        return null;
    }
}

async function createUser(data) {
    try {
        if (!data.name && data.firstName && data.lastName) {
            data.name = `${data.firstName} ${data.lastName}`.trim();
        }
        return await prisma.user.create({ data });
    } catch (error) {
        console.error("Create user error:", error);
        throw error;
    }
}

async function updateUser(id, data) {
    try {
        if ((data.firstName || data.lastName) && !data.name) {
            const current = await prisma.user.findUnique({ where: { id } });
            if (current) {
                data.name = `${data.firstName || current.firstName} ${data.lastName || current.lastName}`.trim();
            }
        }
        return await prisma.user.update({
            where: { id },
            data: { ...data, updatedAt: new Date() }
        });
    } catch (error) {
        console.error("Update user error:", error);
        throw error;
    }
}

async function deleteUser(id) {
    try {
        return await prisma.user.update({
            where: { id },
            data: { isActive: false, updatedAt: new Date() }
        });
    } catch (error) {
        console.error("Delete user error:", error);
        throw error;
    }
}

async function countUsers(filter = {}) {
    try {
        const where = {};
        if (filter.role) where.role = filter.role;
        if (filter.isActive !== undefined) where.isActive = filter.isActive;
        if (filter.createdAt?.$gte) where.createdAt = { gte: filter.createdAt.$gte };
        return await prisma.user.count({ where });
    } catch (error) {
        console.error("Count users error:", error);
        return 0;
    }
}

// Incident helpers
async function createIncident(data) {
    try {
        return await prisma.incident.create({
            data,
            include: { reporter: { select: { id: true, name: true, email: true } } }
        });
    } catch (error) {
        console.error("Create incident error:", error);
        throw error;
    }
}

async function getIncidentById(id) {
    try {
        return await prisma.incident.findUnique({
            where: { id },
            include: {
                reporter: { select: { id: true, name: true, email: true } },
            }
        });
    } catch (error) {
        console.error("Get incident by ID error:", error);
        return null;
    }
}

async function getIncidents(filter = {}) {
    try {
        const where = {};
        if (filter.reportedBy) where.reportedBy = filter.reportedBy;
        
        // Handle status filter - support array for multiple statuses
        if (filter.status) {
            if (Array.isArray(filter.status)) {
                where.status = { in: filter.status };
            } else if (filter.status.$in) {
                where.status = { in: filter.status.$in };
            } else if (typeof filter.status === 'object' && filter.status.in) {
                where.status = { in: filter.status.in };
            } else {
                where.status = filter.status;
            }
        }
        
        if (filter.severity) where.severity = filter.severity;
        
        if (filter.createdAt) {
            if (filter.createdAt.$gte) where.createdAt = { gte: filter.createdAt.$gte };
            if (filter.createdAt.$lte) where.createdAt = { ...where.createdAt, lte: filter.createdAt.$lte };
        }
        
        return await prisma.incident.findMany({
            where,
            include: {
                reporter: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' }
        });
    } catch (error) {
        console.error("Get incidents error:", error);
        return [];
    }
}

async function updateIncident(id, data) {
    try {
        if (data.status) {
            const current = await prisma.incident.findUnique({ where: { id } });
            if (current) {
                const timeline = current.timeline || [];
                timeline.push({
                    status: data.status,
                    timestamp: new Date(),
                    comment: data.timelineComment || `Status updated to ${data.status}`,
                    updatedBy: data.updatedBy
                });
                data.timeline = timeline;
                
                if (['resolved', 'closed'].includes(data.status)) {
                    data.responseTime = {
                        ...(current.responseTime || {}),
                        resolved: new Date()
                    };
                }
            }
        }
        
        return await prisma.incident.update({
            where: { id },
            data,
            include: { reporter: { select: { id: true, name: true, email: true } } }
        });
    } catch (error) {
        console.error("Update incident error:", error);
        throw error;
    }
}

async function countIncidents(filter = {}) {
    try {
        const where = {};
        
        // Handle status filter - support array for multiple statuses
        if (filter.status) {
            if (Array.isArray(filter.status)) {
                where.status = { in: filter.status };
            } else if (filter.status.$in) {
                where.status = { in: filter.status.$in };
            } else if (typeof filter.status === 'object' && filter.status.in) {
                where.status = { in: filter.status.in };
            } else {
                where.status = filter.status;
            }
        }
        
        if (filter.reportedBy) where.reportedBy = filter.reportedBy;
        
        if (filter.createdAt?.$gte) where.createdAt = { gte: filter.createdAt.$gte };
        if (filter.createdAt?.$lte) where.createdAt = { ...where.createdAt, lte: filter.createdAt.$lte };
        
        return await prisma.incident.count({ where });
    } catch (error) {
        console.error("Count incidents error:", error);
        return 0;
    }
}

// Patrol helpers
async function createPatrol(data) {
    try {
        return await prisma.patrol.create({ data });
    } catch (error) {
        console.error("Create patrol error:", error);
        throw error;
    }
}

async function getPatrolById(id) {
    try {
        const patrol = await prisma.patrol.findUnique({
            where: { id },
            include: {
                guardUser: { 
                    select: { 
                        id: true, 
                        name: true, 
                        firstName: true, 
                        lastName: true, 
                        badgeNumber: true 
                    } 
                },
                supervisorUser: { 
                    select: { 
                        id: true, 
                        name: true 
                    } 
                }
            }
        });
        return patrol;
    } catch (error) {
        console.error("Get patrol by ID error:", error);
        return null;
    }
}

async function getPatrols(filter = {}) {
    try {
        const where = {};
        if (filter.guard) where.guard = filter.guard;
        if (filter.status) where.status = filter.status;
        if (filter.startTime) {
            if (filter.startTime.$gte) where.startTime = { gte: filter.startTime.$gte };
            if (filter.startTime.$lte) where.startTime = { ...where.startTime, lte: filter.startTime.$lte };
        }
        
        const patrols = await prisma.patrol.findMany({
            where,
            include: {
                guardUser: { 
                    select: { 
                        id: true, 
                        name: true, 
                        firstName: true, 
                        lastName: true, 
                        badgeNumber: true 
                    } 
                },
                supervisorUser: { 
                    select: { 
                        id: true, 
                        name: true 
                    } 
                }
            },
            orderBy: [
                { startTime: 'desc' }
            ]
        });
        return patrols;
    } catch (error) {
        console.error("Get patrols error:", error);
        return [];
    }
}

async function updatePatrol(id, data) {
    try {
        return await prisma.patrol.update({
            where: { id },
            data: { ...data, updatedAt: new Date() }
        });
    } catch (error) {
        console.error("Update patrol error:", error);
        throw error;
    }
}

async function countPatrols(filter = {}) {
    try {
        const where = {};
        if (filter.guard) where.guard = filter.guard;
        if (filter.status) where.status = filter.status;
        if (filter.startTime?.$gte) where.startTime = { gte: filter.startTime.$gte };
        return await prisma.patrol.count({ where });
    } catch (error) {
        console.error("Count patrols error:", error);
        return 0;
    }
}

// Shift helpers
async function createShift(data) {
    try {
        return await prisma.shift.create({ data });
    } catch (error) {
        console.error("Create shift error:", error);
        throw error;
    }
}

async function getShifts(filter = {}) {
    try {
        const where = {};
        if (filter.guard) where.guard = filter.guard;
        if (filter.status) where.status = filter.status;
        if (filter.date) {
            if (filter.date.$gte) where.date = { gte: filter.date.$gte };
            if (filter.date.$lte) where.date = { ...where.date, lte: filter.date.$lte };
        }
        if (filter.zone) where.zone = filter.zone;
        
        return await prisma.shift.findMany({
            where,
            include: {
                guardUser: { select: { id: true, name: true, firstName: true, lastName: true, badgeNumber: true } },
                supervisorUser: { select: { id: true, name: true } }
            },
            orderBy: [
                { date: 'asc' },
                { startTime: 'asc' }
            ]
        });
    } catch (error) {
        console.error("Get shifts error:", error);
        return [];
    }
}

async function updateShift(id, data) {
    try {
        return await prisma.shift.update({
            where: { id },
            data: { ...data, updatedAt: new Date() }
        });
    } catch (error) {
        console.error("Update shift error:", error);
        throw error;
    }
}

async function countShifts(filter = {}) {
    try {
        const where = {};
        if (filter.guard) where.guard = filter.guard;
        if (filter.status) where.status = filter.status;
        if (filter.date?.$gte) where.date = { gte: filter.date.$gte };
        return await prisma.shift.count({ where });
    } catch (error) {
        console.error("Count shifts error:", error);
        return 0;
    }
}

// Attendance helpers
async function createAttendance(data) {
    try {
        if (data.checkIn?.time && data.checkOut?.time) {
            const hours = (new Date(data.checkOut.time) - new Date(data.checkIn.time)) / (1000 * 60 * 60);
            data.workingHours = Math.round(hours * 10) / 10;
        }
        return await prisma.attendance.create({ data });
    } catch (error) {
        console.error("Create attendance error:", error);
        throw error;
    }
}

async function getAttendances(filter = {}) {
    try {
        const where = {};
        if (filter.guard) where.guard = filter.guard;
        if (filter.status) where.status = filter.status;
        if (filter.date) {
            if (filter.date.$gte) where.date = { gte: filter.date.$gte };
            if (filter.date.$lte) where.date = { ...where.date, lte: filter.date.$lte };
        }
        
        return await prisma.attendance.findMany({
            where,
            include: { guardUser: { select: { id: true, name: true, badgeNumber: true } } },
            orderBy: { date: 'desc' }
        });
    } catch (error) {
        console.error("Get attendances error:", error);
        return [];
    }
}

async function countAttendance(filter = {}) {
    try {
        const where = {};
        if (filter.guard) where.guard = filter.guard;
        if (filter.status) where.status = filter.status;
        if (filter.date?.$gte) where.date = { gte: filter.date.$gte };
        return await prisma.attendance.count({ where });
    } catch (error) {
        console.error("Count attendance error:", error);
        return 0;
    }
}

// Notification helpers
async function createNotification(data) {
    try {
        return await prisma.notification.create({ data });
    } catch (error) {
        console.error("Create notification error:", error);
        throw error;
    }
}

async function getNotifications(filter = {}) {
    try {
        const where = {};
        if (filter.recipient) where.recipient = filter.recipient;
        if (filter.read !== undefined) where.read = filter.read;
        
        return await prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });
    } catch (error) {
        console.error("Get notifications error:", error);
        return [];
    }
}

async function countNotifications(filter = {}) {
    try {
        const where = {};
        if (filter.recipient) where.recipient = filter.recipient;
        if (filter.read !== undefined) where.read = filter.read;
        return await prisma.notification.count({ where });
    } catch (error) {
        console.error("Count notifications error:", error);
        return 0;
    }
}

async function markNotificationRead(id) {
    try {
        return await prisma.notification.update({
            where: { id },
            data: { read: true, readAt: new Date() }
        });
    } catch (error) {
        console.error("Mark notification read error:", error);
        throw error;
    }
}

// Checkpoint helpers
async function createCheckpoint(data) {
    try {
        if (data.code) data.code = data.code.toUpperCase();
        if (data.qrCode) data.qrCode = data.qrCode.toUpperCase();
        if (data.nfcTag) data.nfcTag = data.nfcTag.toUpperCase();
        return await prisma.checkpoint.create({ data });
    } catch (error) {
        console.error("Create checkpoint error:", error);
        throw error;
    }
}

async function getCheckpointByCode(code) {
    try {
        return await prisma.checkpoint.findUnique({
            where: { code: code.toUpperCase() }
        });
    } catch (error) {
        console.error("Get checkpoint by code error:", error);
        return null;
    }
}

async function getCheckpoints(filter = {}) {
    try {
        const where = {};
        if (filter.zone) where.zone = filter.zone;
        if (filter.isActive !== undefined) where.isActive = filter.isActive;
        
        return await prisma.checkpoint.findMany({
            where,
            orderBy: { name: 'asc' }
        });
    } catch (error) {
        console.error("Get checkpoints error:", error);
        return [];
    }
}

// Audit Log helpers
async function createAuditLog(data) {
    try {
        return await prisma.auditLog.create({ data });
    } catch (error) {
        console.error("Create audit log error:", error);
        throw error;
    }
}

async function getAuditLogs(filter = {}) {
    try {
        const where = {};
        if (filter.user) where.user = filter.user;
        if (filter.category) where.category = filter.category;
        if (filter.status) where.status = filter.status;
        if (filter.createdAt) {
            if (filter.createdAt.$gte) where.createdAt = { gte: filter.createdAt.$gte };
            if (filter.createdAt.$lte) where.createdAt = { ...where.createdAt, lte: filter.createdAt.$lte };
        }
        
        return await prisma.auditLog.findMany({
            where,
            include: { userRecord: { select: { id: true, name: true, email: true } } },
            orderBy: { createdAt: 'desc' }
        });
    } catch (error) {
        console.error("Get audit logs error:", error);
        return [];
    }
}

async function countAuditLogs(filter = {}) {
    try {
        const where = {};
        if (filter.user) where.user = filter.user;
        if (filter.category) where.category = filter.category;
        if (filter.status) where.status = filter.status;
        if (filter.createdAt?.$gte) where.createdAt = { gte: filter.createdAt.$gte };
        return await prisma.auditLog.count({ where });
    } catch (error) {
        console.error("Count audit logs error:", error);
        return 0;
    }
}

// API Key helpers
async function createApiKey(data) {
    try {
        return await prisma.apiKey.create({ data });
    } catch (error) {
        console.error("Create API key error:", error);
        throw error;
    }
}

async function getApiKeys(userId) {
    try {
        return await prisma.apiKey.findMany({
            where: { user: userId },
            orderBy: { createdAt: 'desc' }
        });
    } catch (error) {
        console.error("Get API keys error:", error);
        return [];
    }
}

async function deleteApiKey(id, userId) {
    try {
        return await prisma.apiKey.deleteMany({
            where: { id, user: userId }
        });
    } catch (error) {
        console.error("Delete API key error:", error);
        throw error;
    }
}

// Webhook helpers
async function createWebhook(data) {
    try {
        return await prisma.webhook.create({ data });
    } catch (error) {
        console.error("Create webhook error:", error);
        throw error;
    }
}

async function getWebhooks(userId) {
    try {
        return await prisma.webhook.findMany({
            where: { user: userId },
            orderBy: { createdAt: 'desc' }
        });
    } catch (error) {
        console.error("Get webhooks error:", error);
        return [];
    }
}

async function deleteWebhook(id, userId) {
    try {
        return await prisma.webhook.deleteMany({
            where: { id, user: userId }
        });
    } catch (error) {
        console.error("Delete webhook error:", error);
        throw error;
    }
}

// Report helper 
async function createReport(data) {
    try {
        return await prisma.report.create({ data });
    } catch (error) {
        console.error("Create report error:", error);
        throw error;
    }
}

// Backup helpers
async function createBackup(data) {
    try {
        return await prisma.backup.create({ data });
    } catch (error) {
        console.error("Create backup error:", error);
        throw error;
    }
}

async function getBackups(userId) {
    try {
        return await prisma.backup.findMany({
            where: { user: userId },
            orderBy: { createdAt: 'desc' }
        });
    } catch (error) {
        console.error("Get backups error:", error);
        return [];
    }
}

// Support Ticket helpers
async function createSupportTicket(data) {
    try {
        return await prisma.supportTicket.create({ data });
    } catch (error) {
        console.error("Create support ticket error:", error);
        throw error;
    }
}

async function getSupportTickets(filter = {}) {
    try {
        const where = {};
        if (filter.createdBy) where.createdBy = filter.createdBy;
        if (filter.assignedTo) where.assignedTo = filter.assignedTo;
        if (filter.status) where.status = filter.status;
        
        return await prisma.supportTicket.findMany({
            where,
            include: {
                creator: { select: { id: true, name: true, email: true } },
                assignee: { select: { id: true, name: true, email: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
    } catch (error) {
        console.error("Get support tickets error:", error);
        return [];
    }
}

// Session helpers
async function getActiveSessionsCount(userId) {
    try {
        return await prisma.session.count({
            where: { expiresAt: { gt: new Date() } }
        });
    } catch (error) {
        return 0;
    }
}

async function getConnectedDevices(userId, currentSessionId) {
    try {
        const sessions = await prisma.session.findMany({
            where: { expiresAt: { gt: new Date() } }
        });
        
        return sessions.map((session, i) => {
            try {
                const data = JSON.parse(session.data);
                const { browser, os } = parseUserAgent(data.userAgent || "Unknown");
                return {
                    id: session.sid,
                    name: `Device ${i + 1}`,
                    browser, os,
                    lastActive: new Date(data.lastActive || Date.now()),
                    location: data.location || "Unknown",
                    icon: getDeviceIcon(os),
                    isCurrent: session.sid === currentSessionId,
                };
            } catch (e) {
                return {
                    id: session.sid,
                    name: `Device ${i + 1}`,
                    browser: "Unknown", os: "Unknown",
                    lastActive: session.expiresAt,
                    location: "Unknown",
                    icon: "fa-laptop",
                    isCurrent: session.sid === currentSessionId,
                };
            }
        });
    } catch (error) {
        return [];
    }
}

// Timeline and analytics helpers
async function getTimelineData(Model, start, end, dateField = 'createdAt') {
    try {
        const data = [];
        const current = new Date(start);
        while (current <= end) {
            const next = new Date(current);
            next.setDate(next.getDate() + 1);
            
            let count = 0;
            if (Model === prisma.incident) {
                count = await prisma.incident.count({
                    where: {
                        [dateField]: { gte: current, lt: next }
                    }
                });
            } else if (Model === prisma.patrol) {
                count = await prisma.patrol.count({
                    where: {
                        [dateField]: { gte: current, lt: next }
                    }
                });
            } else if (Model === prisma.user) {
                count = await prisma.user.count({
                    where: {
                        [dateField]: { gte: current, lt: next }
                    }
                });
            }
            
            data.push({ date: current.toISOString().split("T")[0], count });
            current.setDate(current.getDate() + 1);
        }
        return data;
    } catch (error) {
        console.error("Get timeline data error:", error);
        return [];
    }
}

async function getDailyAttendance(start, end) {
    try {
        const data = [];
        const current = new Date(start);
        while (current <= end) {
            const next = new Date(current);
            next.setDate(next.getDate() + 1);
            
            const records = await prisma.attendance.findMany({
                where: { date: { gte: current, lt: next } }
            });
            
            data.push({
                date: current.toISOString().split("T")[0],
                present: records.filter((a) => a.status === "present").length,
                late: records.filter((a) => a.status === "late").length,
                absent: records.filter((a) => a.status === "absent").length,
                total: records.length,
            });
            current.setDate(current.getDate() + 1);
        }
        return data;
    } catch (error) {
        console.error("Get daily attendance error:", error);
        return [];
    }
}

async function getShiftsByZone(shifts) {
    try {
        const zones = {};
        shifts.forEach((s) => { 
            if (s.zone) zones[s.zone] = (zones[s.zone] || 0) + 1; 
        });
        return Object.entries(zones).map(([zone, count]) => ({ zone: formatZone(zone), count }));
    } catch (error) {
        console.error("Get shifts by zone error:", error);
        return [];
    }
}

async function getGuardCompliance(patrols) {
    try {
        const guardStats = {};
        patrols.forEach((patrol) => {
            if (!patrol.guard) return;
            const id = patrol.guard;
            if (!guardStats[id]) guardStats[id] = { name: "Unknown", completed: 0, total: 0 };
            if (patrol.checkpoints && Array.isArray(patrol.checkpoints)) {
                guardStats[id].total += patrol.checkpoints.length;
                guardStats[id].completed += patrol.checkpoints.filter((c) => c.status === "completed").length;
            }
        });
        
        for (const id in guardStats) {
            const guard = await prisma.user.findUnique({
                where: { id },
                select: { name: true }
            });
            if (guard) guardStats[id].name = guard.name;
        }
        
        return Object.values(guardStats)
            .map((g) => ({ ...g, rate: g.total > 0 ? Math.round((g.completed / g.total) * 100) : 0 }))
            .sort((a, b) => b.rate - a.rate)
            .slice(0, 10);
    } catch (error) {
        console.error("Get guard compliance error:", error);
        return [];
    }
}

// System helpers
async function getDatabaseSize() {
    try {
        const result = await prisma.$queryRaw`
            SELECT pg_database_size(current_database()) as size
        `;
        const sizeInMB = (result[0].size / (1024 * 1024)).toFixed(2);
        return `${sizeInMB} MB`;
    } catch (_) { 
        return "Unknown"; 
    }
}

async function getLastBackupTime() {
    try {
        const last = await prisma.report.findFirst({
            where: { type: "custom" },
            orderBy: { createdAt: 'desc' }
        });
        return last ? last.createdAt : null;
    } catch (_) { 
        return null; 
    }
}

async function getCollectionCounts() {
    const counts = {};
    try { counts.users = await prisma.user.count(); } catch (_) { counts.users = 0; }
    try { counts.incidents = await prisma.incident.count(); } catch (_) { counts.incidents = 0; }
    try { counts.patrols = await prisma.patrol.count(); } catch (_) { counts.patrols = 0; }
    try { counts.shifts = await prisma.shift.count(); } catch (_) { counts.shifts = 0; }
    try { counts.attendances = await prisma.attendance.count(); } catch (_) { counts.attendances = 0; }
    try { counts.notifications = await prisma.notification.count(); } catch (_) { counts.notifications = 0; }
    try { counts.checkpoints = await prisma.checkpoint.count(); } catch (_) { counts.checkpoints = 0; }
    try { counts.auditlogs = await prisma.auditLog.count(); } catch (_) { counts.auditlogs = 0; }
    return counts;
}

async function measureResponseTime() {
    const start = Date.now();
    try { 
        await prisma.user.findFirst(); 
        return (Date.now() - start) + "ms"; 
    } catch (_) { 
        return "Error"; 
    }
}

function getRequestsPerMinute() { 
    return Math.floor(Math.random() * 50) + 10; 
}

async function testEmailConnection() { 
    return { success: true }; 
}

async function sendTestEmail() { 
    return { success: true }; 
}

async function calculateAverageResponseTime() {
    try {
        const tickets = await prisma.supportTicket.findMany({
            where: { messages: { not: null } },
            take: 100
        });
        if (!tickets.length) return 2.5;
        let total = 0, count = 0;
        tickets.forEach((t) => {
            if (t.messages && Array.isArray(t.messages) && t.messages.length > 1) {
                total += (new Date(t.messages[1].createdAt) - new Date(t.createdAt)) / 3600000;
                count++;
            }
        });
        return count > 0 ? parseFloat((total / count).toFixed(1)) : 2.5;
    } catch (_) { 
        return 2.5; 
    }
}


// ================== MIDDLEWARE ==================

const isAuthenticated = async (req, res, next) => {
    if (req.session && req.session.userId) {
        const user = await getUserById(req.session.userId);
        if (user && user.isActive) return next();
        req.session.destroy();
        return res.redirect("/login");
    }
    res.redirect("/login");
};

const hasRole = (roles) => (req, res, next) => {
    if (!req.session?.userId) return res.redirect("/login");
    if (roles.includes(req.session.userRole)) return next();
    res.status(403).render("error", { title: "Access Denied", message: "You don't have permission to access this page.", error: {} });
};

app.use(async (req, res, next) => {
    res.locals.currentUser = null;
    res.locals.notificationCount = 0;
    res.locals.success_msg = null;
    res.locals.error_msg = null;
    
    if (req.session?.userId) {
        try {
            const user = await getUserById(req.session.userId);
            if (user) {
                res.locals.currentUser = user;
                res.locals.notificationCount = await countNotifications({ recipient: user.id, read: false }) || 0;
            }
        } catch (err) { console.error("Error loading user data:", err); }
    }
    next();
});

// ================== AUTHENTICATION ROUTES ==================

app.get("/", (req, res) => {
    try {
        res.render("index", { title: "Campus Guard Connect - Home", layout: false });
    } catch (err) {
        console.error("❌ Home page error:", err);
        res.status(500).send("Error loading home page");
    }
});

app.get("/login", (req, res) => {
    try {
        if (req.session?.userId) return res.redirect("/dashboard");
        res.render("login", { title: "Login - Campus Guard Connect", layout: false, error_msg: null, success_msg: null, email: "" });
    } catch (err) {
        console.error("❌ Login page error:", err);
        res.status(500).send("Error loading login page");
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.render("login", { title: "Login - Campus Guard Connect", error_msg: "Email and password are required", layout: false, email: email || "" });
        }
        
        const user = await getUserByEmail(email.toLowerCase());
        if (!user) return res.render("login", { title: "Login - Campus Guard Connect", error_msg: "Invalid email or password", layout: false, email });
        if (!user.isActive) return res.render("login", { title: "Login - Campus Guard Connect", error_msg: "Your account has been deactivated. Contact administrator.", layout: false, email });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.render("login", { title: "Login - Campus Guard Connect", error_msg: "Invalid email or password", layout: false, email });
        
        req.session.userId = user.id;
        req.session.userEmail = user.email;
        req.session.userRole = user.role;
        req.session.userName = user.name;
        
        await updateUser(user.id, { lastLogin: new Date() });
        
        try {
            await createAuditLog({
                user: user.id,
                action: "LOGIN",
                category: "auth",
                description: "User logged in successfully",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.redirect("/dashboard");
    } catch (err) {
        console.error("❌ Login error:", err);
        res.render("login", { title: "Login - Campus Guard Connect", error_msg: "An error occurred. Please try again.", layout: false, email: req.body.email || "" });
    }
});

app.get("/register", (req, res) => {
    try {
        if (req.session?.userId) return res.redirect("/dashboard");
        res.render("register", { title: "Register - Campus Guard Connect", layout: false, firstName: "", lastName: "", email: "", role: "", phone: "", institution: "", badgeNumber: "", errors: [], error_msg: null, success_msg: null });
    } catch (err) {
        console.error("❌ Register page error:", err);
        res.status(500).send("Error loading registration page");
    }
});

app.post("/register", async (req, res) => {
    const { firstName, lastName, email, password, confirmPassword, role, phone, institution, badgeNumber, terms } = req.body;
    const errors = [];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!firstName?.trim() || firstName.length < 2) errors.push({ msg: "First name must be at least 2 characters", field: "firstName" });
    if (!lastName?.trim() || lastName.length < 2) errors.push({ msg: "Last name must be at least 2 characters", field: "lastName" });
    if (!email || !emailRegex.test(email)) errors.push({ msg: "Please enter a valid email address", field: "email" });
    if (!password || password.length < 6) errors.push({ msg: "Password must be at least 6 characters", field: "password" });
    if (password !== confirmPassword) errors.push({ msg: "Passwords do not match", field: "confirmPassword" });
    if (!terms) errors.push({ msg: "You must agree to the Terms of Service", field: "terms" });

    if (email && emailRegex.test(email)) {
        const existing = await getUserByEmail(email.toLowerCase());
        if (existing) errors.push({ msg: "Email is already registered", field: "email" });
    }
    if (role === "guard" || role === "supervisor") {
        if (!badgeNumber?.trim()) {
            errors.push({ msg: "Badge number is required for security personnel", field: "badgeNumber" });
        } else {
            const existingBadge = await prisma.user.findUnique({ where: { badgeNumber: badgeNumber.toUpperCase() } });
            if (existingBadge) errors.push({ msg: "Badge number already in use", field: "badgeNumber" });
        }
    }

    const renderData = { title: "Register - Campus Guard Connect", layout: false, firstName, lastName, email, role, phone, institution, badgeNumber };
    if (errors.length > 0) return res.render("register", { ...renderData, errors });

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const userData = {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: role || "student",
            phoneNumber: phone?.trim() || "",
            institution: institution?.trim() || "",
            isActive: true,
            createdAt: new Date(),
            lastLogin: new Date(),
        };
        
        if ((role === "guard" || role === "supervisor") && badgeNumber) {
            userData.badgeNumber = badgeNumber.toUpperCase().trim();
        }
        
        const newUser = await createUser(userData);
        
        try {
            await createAuditLog({
                user: newUser.id,
                action: "REGISTER",
                category: "auth",
                description: "New user registered",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        req.session.userId = newUser.id;
        req.session.userEmail = newUser.email;
        req.session.userRole = newUser.role;
        req.session.userName = newUser.name;
        
        res.redirect("/dashboard");
    } catch (err) {
        console.error("❌ Registration error:", err);
        if (err.code === 'P2002') {
            const field = err.meta?.target?.[0] || "field";
            return res.render("register", { 
                ...renderData, 
                error_msg: field === "email" ? "Email is already registered" : "Badge number is already in use" 
            });
        }
        res.render("register", { ...renderData, error_msg: "Registration failed. Please try again." });
    }
});

app.get("/logout", async (req, res) => {
    try {
        if (req.session?.userId) {
            await createAuditLog({
                user: req.session.userId,
                action: "LOGOUT",
                category: "auth",
                description: "User logged out",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        }
    } catch (_) {}
    req.session.destroy(() => res.redirect("/login"));
});

// ================== DASHBOARD ==================

app.get("/dashboard", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        if (!user) { req.session.destroy(); return res.redirect("/login"); }
        
        const role = user.role;
        let stats = {};
        let recentIncidents = [];
        let activeGuards = [];
        let notifications = [];
        
        const currentDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

        try {
            if (role === "admin") {
                stats = {
                    activeGuards: await countUsers({ role: "guard", isActive: true }) || 0,
                    activePatrols: await countPatrols({ status: "in_progress" }) || 0,
                    pendingIncidents: await countIncidents({ status: { $in: ["reported", "acknowledged"] } }) || 0,
                    avgResponseTime: "2.4",
                };
                recentIncidents = await getIncidents({}) || [];
                recentIncidents = recentIncidents.slice(0, 5);
            } else if (role === "supervisor") {
                stats = { 
                    teamMembers: await countUsers({ role: "guard", isActive: true }) || 0, 
                    patrolCompletion: 94, 
                    attendanceRate: 98, 
                    teamRating: 4.8 
                };
                activeGuards = await prisma.user.findMany({
                    where: { role: "guard", isActive: true },
                    take: 5
                }) || [];
            } else if (role === "guard") {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const currentShift = await prisma.shift.findFirst({
                    where: { guard: user.id, date: { gte: today } }
                });
                stats = {
                    currentShift: currentShift || "No shift today",
                    assignedPatrols: await countPatrols({ guard: user.id, status: "scheduled" }) || 0,
                    checkpointsCompleted: await countPatrols({ guard: user.id }) || 0,
                    hoursWorked: "6.5",
                };
            } else if (role === "student") {
                stats = { 
                    campusStatus: "Safe", 
                    emergencyLine: "24/7", 
                    guardsOnDuty: await countUsers({ role: "guard", isActive: true }) || 0, 
                    camerasActive: 142 
                };
            }
        } catch (statsErr) { console.error("⚠️ Error loading stats:", statsErr); }

        try {
            notifications = await getNotifications({ recipient: user.id, read: false }) || [];
            notifications = notifications.slice(0, 5);
        } catch (_) {}

        const isNewUser = (Date.now() - new Date(user.createdAt)) < 5 * 60 * 1000;

        res.render("dashboard", {
            title: `${role.charAt(0).toUpperCase() + role.slice(1)} Dashboard - Campus Guard Connect`,
            layout: false,
            user: { 
                _id: user.id, 
                firstName: user.firstName, 
                lastName: user.lastName, 
                name: user.name, 
                email: user.email, 
                role: user.role, 
                badgeNumber: user.badgeNumber, 
                profileImage: user.profileImage, 
                initials: getInitials(user.name) 
            },
            stats,
            recentIncidents: recentIncidents.map((i) => ({ 
                _id: i.id, 
                title: i.title || i.description || "Untitled Incident", 
                location: i.location?.name || i.location || "Unknown Location", 
                severity: i.severity || "medium", 
                time: formatRelativeTime(i.createdAt), 
                reporter: i.reporter?.name || "Anonymous" 
            })),
            activeGuards: activeGuards.map((g) => ({ 
                _id: g.id, 
                name: g.name || `${g.firstName} ${g.lastName}`, 
                initials: getInitials(g.name || `${g.firstName} ${g.lastName}`), 
                location: "Main Campus", 
                status: "online" 
            })),
            notifications: notifications.map((n) => ({ 
                ...n, 
                time: formatRelativeTime(n.createdAt) 
            })),
            currentDate, 
            currentTime: new Date().toLocaleTimeString(),
            notificationCount: notifications.length, 
            incidentCount: stats.pendingIncidents || 0, 
            isNewUser,
        });
    } catch (err) {
        console.error("❌ Dashboard error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading dashboard", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

// ================== INCIDENT ROUTES ==================

app.get("/incidents", isAuthenticated, async (req, res) => {
    try {
        const filter = req.session.userRole === "student" ? { reportedBy: req.session.userId } : {};
        const incidents = await getIncidents(filter);
        
        // Calculate stats for the template
        const totalIncidents = incidents.length;
        const openIncidents = incidents.filter(i => ["reported", "acknowledged", "investigating", "in_progress"].includes(i.status)).length;
        const resolvedToday = incidents.filter(i => {
            const today = new Date().toDateString();
            return ["resolved", "closed"].includes(i.status) && new Date(i.updatedAt).toDateString() === today;
        }).length;
        
        // Calculate average response time
        let totalResponseTime = 0;
        let responseCount = 0;
        incidents.forEach(i => {
            if (i.responseTime?.acknowledged && i.createdAt) {
                totalResponseTime += (new Date(i.responseTime.acknowledged) - new Date(i.createdAt)) / 60000;
                responseCount++;
            }
        });
        const avgResponseTime = responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0;
        
        // Calculate type stats for quick stats display
        const typeStats = {
            theft: incidents.filter(i => i.type === "theft").length,
            vandalism: incidents.filter(i => i.type === "vandalism").length,
            unauthorized: incidents.filter(i => i.type === "unauthorized_access").length,
            medical: incidents.filter(i => i.type === "medical_emergency").length,
            fire: incidents.filter(i => i.type === "fire").length,
            other: incidents.filter(i => ["other", "suspicious_activity", "accident", "assault", "harassment", "noise_complaint", "property_damage"].includes(i.type)).length
        };
        
        // Format incidents for the template
        const formattedIncidents = incidents.map(incident => ({
            _id: incident.id,
            id: incident.id,
            title: incident.title || "Untitled",
            description: incident.description || "",
            type: incident.type || "other",
            severity: incident.severity || "medium",
            status: incident.status || "reported",
            location: {
                name: incident.location?.name || "Unknown",
                building: incident.location?.building || "",
                room: incident.location?.room || "",
                coordinates: incident.location?.coordinates || null
            },
            reportedBy: {
                name: incident.reporter?.name || "Anonymous",
                email: incident.reporter?.email || "",
                role: incident.reporter?.role || "unknown"
            },
            createdAt: incident.createdAt,
            updatedAt: incident.updatedAt,
            timeline: incident.timeline || [],
            responseTime: incident.responseTime || null
        }));
        
        // Basic stats for the old template format
        const stats = {
            total: totalIncidents,
            critical: incidents.filter((i) => i.severity === "critical").length,
            high: incidents.filter((i) => i.severity === "high").length,
            medium: incidents.filter((i) => i.severity === "medium").length,
            low: incidents.filter((i) => i.severity === "low").length,
            open: openIncidents,
            resolved: incidents.filter((i) => ["resolved", "closed"].includes(i.status)).length,
        };
        
        res.render("incident", { 
            title: "Incidents - Campus Guard Connect", 
            layout: false,
            user: res.locals.currentUser,
            notificationCount: res.locals.notificationCount || 0,
            incidents: formattedIncidents,
            stats: stats,
            totalIncidents: totalIncidents,
            openIncidents: openIncidents,
            resolvedToday: resolvedToday,
            avgResponseTime: avgResponseTime,
            typeStats: typeStats,
            viewType: "list"
        });
    } catch (err) {
        console.error("❌ Error loading incidents:", err);
        res.status(500).render("incident", { 
            title: "Error", 
            message: "Error loading incidents", 
            viewType: "error", 
            error: process.env.NODE_ENV === "development" ? err : {}, 
            layout: false 
        });
    }
});

app.get("/incidents/report", isAuthenticated, (req, res) => {
    res.render("incident", { 
        title: "Report Incident - Campus Guard Connect", 
        viewType: "report", 
        user: res.locals.currentUser, 
        layout: false, 
        error_msg: null 
    });
});

app.post("/incidents/report", isAuthenticated, async (req, res) => {
    try {
        const { title, description, type, severity, location, building, floor, room } = req.body;
        if (!title || !description || !type || !location) {
            return res.render("incident", { 
                title: "Report Incident - Campus Guard Connect", 
                viewType: "report", 
                user: res.locals.currentUser, 
                layout: false, 
                error_msg: "Please fill in all required fields" 
            });
        }
        
        const incident = await createIncident({
            title,
            description,
            type,
            severity: severity || "medium",
            location: { name: location, building: building || "", floor: floor || "", room: room || "" },
            reportedBy: req.session.userId,
            status: "reported",
            timeline: [{ status: "reported", comment: "Incident reported", updatedBy: req.session.userId, timestamp: new Date() }],
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "CREATE_INCIDENT",
                category: "incident",
                description: `Incident reported: ${title}`,
                targetId: incident.id,
                targetModel: "Incident",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent")
            });
        } catch (_) {}
        
        try {
            const admins = await prisma.user.findMany({
                where: { role: { in: ["admin", "supervisor"] } }
            });
            for (const admin of admins) {
                await createNotification({
                    recipient: admin.id,
                    type: "alert",
                    title: "New Incident Reported",
                    message: `${title} - ${severity} severity`,
                    relatedTo: { model: "Incident", id: incident.id },
                    priority: severity === "critical" ? "urgent" : "high"
                });
            }
        } catch (_) {}
        
        res.redirect("/incidents");
    } catch (err) {
        console.error("❌ Error reporting incident:", err);
        res.render("incident", { 
            title: "Report Incident - Campus Guard Connect", 
            viewType: "report", 
            user: res.locals.currentUser, 
            layout: false, 
            error_msg: "Failed to report incident. Please try again." 
        });
    }
});

app.get("/incidents/:id", isAuthenticated, async (req, res) => {
    try {
        const incident = await getIncidentById(req.params.id);
        if (!incident) return res.status(404).render("incident", { 
            title: "Not Found", 
            message: "Incident not found", 
            viewType: "error", 
            error: {}, 
            layout: false 
        });
        
        if (req.session.userRole === "student" && incident.reportedBy !== req.session.userId) {
            return res.status(403).render("incident", { 
                title: "Access Denied", 
                message: "You don't have permission to view this incident", 
                viewType: "error", 
                error: {}, 
                layout: false 
            });
        }
        
        // Format incident for view
        const formattedIncident = {
            _id: incident.id,
            id: incident.id,
            title: incident.title,
            description: incident.description,
            type: incident.type,
            severity: incident.severity,
            status: incident.status,
            location: incident.location,
            reportedBy: incident.reporter || { name: "Anonymous" },
            assignedTo: incident.assignedTo || [],
            timeline: incident.timeline || [],
            createdAt: incident.createdAt,
            updatedAt: incident.updatedAt,
            responseTime: incident.responseTime
        };
        
        res.render("incident", { 
            title: `Incident: ${incident.title} - Campus Guard Connect`, 
            incident: formattedIncident, 
            viewType: "view", 
            user: res.locals.currentUser, 
            layout: false 
        });
    } catch (err) {
        console.error("❌ Error loading incident:", err);
        res.status(500).render("incident", { 
            title: "Error", 
            message: "Error loading incident", 
            viewType: "error", 
            error: {}, 
            layout: false 
        });
    }
});

app.post("/incidents/:id/status", isAuthenticated, async (req, res) => {
    try {
        const { status, comment } = req.body;
        const incident = await getIncidentById(req.params.id);
        if (!incident) return res.status(404).json({ error: "Incident not found" });
        if (req.session.userRole === "student") return res.status(403).json({ error: "Permission denied" });
        
        await updateIncident(req.params.id, {
            status,
            timelineComment: comment || `Status updated to ${status}`,
            updatedBy: req.session.userId
        });
        
        try {
            await createNotification({
                recipient: incident.reportedBy,
                type: "info",
                title: "Incident Status Updated",
                message: `Incident #${incident.id} is now ${status}`,
                relatedTo: { model: "Incident", id: incident.id }
            });
        } catch (_) {}
        
        res.redirect(`/incidents/${req.params.id}`);
    } catch (err) {
        console.error("❌ Error updating incident:", err);
        res.status(500).json({ error: "Failed to update incident" });
    }
});

// API endpoint for viewing incident details (used by the modal)
app.get("/api/incidents/:id", isAuthenticated, async (req, res) => {
    try {
        const incident = await prisma.incident.findUnique({
            where: { id: req.params.id },
            include: {
                reporter: { select: { id: true, name: true, email: true, role: true } }
            }
        });
        
        if (!incident) {
            return res.status(404).json({ error: "Incident not found" });
        }
        
        res.json({
            id: incident.id,
            title: incident.title,
            description: incident.description,
            type: incident.type,
            severity: incident.severity,
            status: incident.status,
            location: incident.location,
            reportedBy: incident.reporter || { name: "Anonymous" },
            createdAt: incident.createdAt,
            updatedAt: incident.updatedAt,
            timeline: incident.timeline || [],
            responseTime: incident.responseTime
        });
    } catch (err) {
        console.error("Error fetching incident:", err);
        res.status(500).json({ error: err.message });
    }
});

// ================== SCHEDULE ROUTE ==================

app.get("/schedule", isAuthenticated, async (req, res) => {
    try {
        const filter = req.session.userRole === "guard" ? { guard: req.session.userId } : {};
        const shifts = await getShifts(filter);
        
        let availableGuards = [];
        if (["admin", "supervisor"].includes(req.session.userRole)) {
            availableGuards = await prisma.user.findMany({
                where: { role: { in: ["guard", "supervisor"] }, isActive: true },
                select: { id: true, name: true, firstName: true, lastName: true, badgeNumber: true }
            });
        }
        
        res.render("schedule", {
            title: "Schedule - Campus Guard Connect",
            shifts,
            availableGuards,
            user: res.locals.currentUser,
            currentDate: new Date().toISOString().split("T")[0],
            todayDate: new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
            layout: false,
        });
    } catch (err) {
        console.error("❌ Error loading schedule:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading schedule", error: {} });
    }
});

// ================== REPORTS ROUTES ==================

app.get("/reports", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const endDate = req.query.end ? new Date(req.query.end) : new Date();
        const startDate = req.query.start ? new Date(req.query.start) : new Date(endDate);
        if (!req.query.start) startDate.setDate(startDate.getDate() - 30);

        const start = new Date(startDate); start.setHours(0, 0, 0, 0);
        const end = new Date(endDate); end.setHours(23, 59, 59, 999);

        const incidentFilter = { createdAt: { $gte: start, $lte: end } };
        if (req.session.userRole === "guard") incidentFilter.assignedTo = { has: req.session.userId };
        else if (req.session.userRole === "student") incidentFilter.reportedBy = req.session.userId;

        const incidents = await getIncidents(incidentFilter);
        const totalIncidents = incidents.length;
        const resolvedIncidents = incidents.filter((i) => ["resolved", "closed"].includes(i.status)).length;
        const resolutionRate = totalIncidents > 0 ? Math.round((resolvedIncidents / totalIncidents) * 100) : 0;
        const criticalIncidents = incidents.filter((i) => i.severity === "critical").length;
        const highIncidents = incidents.filter((i) => i.severity === "high").length;
        const mediumIncidents = incidents.filter((i) => i.severity === "medium").length;
        const lowIncidents = incidents.filter((i) => i.severity === "low").length;

        let totalResponseTime = 0, responseTimeCount = 0;
        incidents.forEach((i) => {
            if (i.responseTime?.acknowledged && i.createdAt) {
                totalResponseTime += (new Date(i.responseTime.acknowledged) - new Date(i.createdAt)) / 60000;
                responseTimeCount++;
            }
        });
        const avgResponseTime = responseTimeCount > 0 ? (totalResponseTime / responseTimeCount).toFixed(1) : 0;

        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const monthlyData = {};
        monthNames.forEach((m) => (monthlyData[m] = 0));
        incidents.forEach((i) => { const m = monthNames[new Date(i.createdAt).getMonth()]; monthlyData[m] = (monthlyData[m] || 0) + 1; });

        const typeCounts = {};
        incidents.forEach((i) => { typeCounts[i.type] = (typeCounts[i.type] || 0) + 1; });

        const patrolFilter = { startTime: { $gte: start, $lte: end } };
        if (req.session.userRole === "guard") patrolFilter.guard = req.session.userId;
        const patrols = await getPatrols(patrolFilter);
        const totalPatrols = patrols.length;
        const completedPatrols = patrols.filter((p) => p.status === "completed").length;
        const patrolCompletionRate = totalPatrols > 0 ? Math.round((completedPatrols / totalPatrols) * 100) : 0;

        const guardStats = {
            totalGuards: await countUsers({ role: "guard", isActive: true }),
            activeGuards: await countUsers({ role: "guard", isActive: true, lastLogin: { $gte: start } }),
            newGuards: await countUsers({ role: "guard", createdAt: { $gte: start, $lte: end } }),
        };

        const guards = await prisma.user.findMany({
            where: { role: "guard", isActive: true },
            select: { id: true, name: true, firstName: true, lastName: true, badgeNumber: true }
        });
        
        const topGuards = await Promise.all(guards.map(async (guard) => {
            const guardPatrols = await countPatrols({ guard: guard.id, startTime: { $gte: start, $lte: end } });
            const guardIncidents = await countIncidents({ assignedTo: { has: guard.id }, createdAt: { $gte: start, $lte: end } });
            const gData = await getIncidents({ assignedTo: { has: guard.id }, createdAt: { $gte: start, $lte: end } });
            let totalResp = 0;
            gData.forEach((inc) => { if (inc.responseTime?.acknowledged) totalResp += (new Date(inc.responseTime.acknowledged) - new Date(inc.createdAt)) / 60000; });
            const avgResp = gData.length > 0 ? (totalResp / gData.length).toFixed(1) : 0;
            const rating = ((guardPatrols + guardIncidents) / 5 + Math.max(0, 5 - avgResp)).toFixed(1);
            return { 
                _id: guard.id, 
                name: guard.name || `${guard.firstName} ${guard.lastName}`, 
                initials: getInitials(guard.name || `${guard.firstName} ${guard.lastName}`), 
                patrols: guardPatrols, 
                incidents: guardIncidents, 
                responseTime: avgResp, 
                rating 
            };
        }));
        topGuards.sort((a, b) => b.rating - a.rating);

        const attendanceRecords = await getAttendances({ date: { $gte: start, $lte: end } });
        const totalCheckins = attendanceRecords.length;
        const onTimeCheckins = attendanceRecords.filter((a) => a.status === "present").length;
        const attendanceRate = totalCheckins > 0 ? Math.round((onTimeCheckins / totalCheckins) * 100) : 0;

        const shiftsList = await getShifts({ date: { $gte: start, $lte: end } });
        const totalShifts = shiftsList.length;
        const completedShifts = shiftsList.filter((s) => s.status === "completed").length;
        const missedShifts = shiftsList.filter((s) => s.status === "missed").length;
        const totalOvertime = shiftsList.reduce((sum, s) => sum + (s.overtime || 0), 0);

        const checkpointsList = await getCheckpoints({ isActive: true });
        let completedCheckpoints = 0, totalExpectedCheckpoints = 0;
        patrols.forEach((p) => {
            if (p.checkpoints && Array.isArray(p.checkpoints)) {
                totalExpectedCheckpoints += p.checkpoints.length;
                completedCheckpoints += p.checkpoints.filter((c) => c.status === "completed").length;
            }
        });
        const complianceRate = totalExpectedCheckpoints > 0 ? Math.round((completedCheckpoints / totalExpectedCheckpoints) * 100) : 0;

        const recentIncidentsList = await getIncidents({});
        recentIncidentsList.slice(0, 10);

        const prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 30);
        const prevEnd = new Date(end); prevEnd.setDate(prevEnd.getDate() - 30);
        const previousIncidents = await countIncidents({ createdAt: { $gte: prevStart, $lte: prevEnd } });
        const incidentChange = previousIncidents > 0 ? Math.round(((totalIncidents - previousIncidents) / previousIncidents) * 100) : 0;

        res.render("reports", {
            title: "Reports & Analytics - Campus Guard Connect", 
            layout: false,
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) },
            notificationCount: res.locals.notificationCount || 0,
            dateRange: { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0], display: `${start.toLocaleDateString()} - ${end.toLocaleDateString()}` },
            stats: { 
                totalIncidents, periodIncidents: totalIncidents, avgResponseTime, resolutionRate, 
                criticalIncidents, highIncidents, mediumIncidents, lowIncidents, resolvedIncidents, 
                totalPatrols, completedPatrols, patrolCompletionRate, 
                totalGuards: guardStats.totalGuards, activeGuards: guardStats.activeGuards, 
                newGuards: guardStats.newGuards, attendanceRate, totalShifts, completedShifts, 
                missedShifts, totalOvertime, complianceRate, 
                criticalChange: incidentChange > 0 ? `+${incidentChange}` : incidentChange 
            },
            chartData: { 
                monthlyLabels: Object.keys(monthlyData), 
                monthlyData: Object.values(monthlyData), 
                severityData: [criticalIncidents, highIncidents, mediumIncidents, lowIncidents], 
                incidentTypes: Object.entries(typeCounts).map(([type, count]) => ({ type, count })) 
            },
            recentIncidents: recentIncidentsList.map((i) => ({ 
                _id: i.id, title: i.title, type: i.type, severity: i.severity, 
                status: i.status, location: i.location, reportedBy: i.reporter, 
                createdAt: i.createdAt, 
                responseTime: i.responseTime?.acknowledged ? Math.round((new Date(i.responseTime.acknowledged) - new Date(i.createdAt)) / 60000) : null 
            })),
            topGuards: topGuards.slice(0, 5),
            highRiskZones: [],
        });
    } catch (err) {
        console.error("❌ Reports error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading reports", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

app.get("/reports/export", isAuthenticated, async (req, res) => {
    try {
        const { type, format, from, to } = req.query;
        const { Parser } = require("json2csv");
        const start = from ? new Date(from) : new Date(); 
        if (!from) start.setDate(start.getDate() - 30); 
        start.setHours(0, 0, 0, 0);
        const end = to ? new Date(to) : new Date(); 
        end.setHours(23, 59, 59, 999);
        let data = [];
        const filename = `${type}-report-${start.toISOString().split("T")[0]}-to-${end.toISOString().split("T")[0]}`;

        switch (type) {
            case "incidents":
                const incidents = await getIncidents({ createdAt: { $gte: start, $lte: end } });
                data = incidents.map((i) => ({ 
                    ID: i.id, Title: i.title, Description: i.description, Type: i.type, 
                    Severity: i.severity, Status: i.status, Location: i.location?.name, 
                    Building: i.location?.building, Floor: i.location?.floor, Room: i.location?.room, 
                    ReportedBy: i.reporter?.name, ReportedEmail: i.reporter?.email, 
                    ReportedAt: i.createdAt ? new Date(i.createdAt).toLocaleString() : "", 
                    ResolvedAt: i.responseTime?.resolved ? new Date(i.responseTime.resolved).toLocaleString() : "", 
                    ResponseTime: i.responseTime?.acknowledged ? Math.round((new Date(i.responseTime.acknowledged) - new Date(i.createdAt)) / 60000) + " min" : "Pending" 
                }));
                break;
            case "patrols":
                const patrols = await getPatrols({ startTime: { $gte: start, $lte: end } });
                data = patrols.map((p) => ({ 
                    ID: p.id, Guard: p.guardUser?.name, BadgeNumber: p.guardUser?.badgeNumber, 
                    Supervisor: p.supervisorUser?.name, StartTime: p.startTime ? new Date(p.startTime).toLocaleString() : "", 
                    EndTime: p.endTime ? new Date(p.endTime).toLocaleString() : "", Status: p.status, 
                    CheckpointsCompleted: p.checkpoints?.filter((c) => c.status === "completed").length || 0, 
                    TotalCheckpoints: p.checkpoints?.length || 0, Notes: p.notes || "" 
                }));
                break;
            case "guards":
                const guards = await prisma.user.findMany({ where: { role: "guard" }, select: { name: true, email: true, badgeNumber: true, phoneNumber: true, isActive: true, lastLogin: true, createdAt: true } });
                data = guards.map((g) => ({ 
                    Name: g.name, Email: g.email, BadgeNumber: g.badgeNumber || "N/A", 
                    Phone: g.phoneNumber || "N/A", Status: g.isActive ? "Active" : "Inactive", 
                    LastLogin: g.lastLogin ? new Date(g.lastLogin).toLocaleString() : "Never", 
                    JoinedDate: g.createdAt ? new Date(g.createdAt).toLocaleString() : "" 
                }));
                break;
            case "attendance":
                const attendance = await getAttendances({ date: { $gte: start, $lte: end } });
                data = attendance.map((a) => ({ 
                    Guard: a.guardUser?.name, BadgeNumber: a.guardUser?.badgeNumber, 
                    Date: a.date ? new Date(a.date).toLocaleDateString() : "", 
                    CheckInTime: a.checkIn?.time ? new Date(a.checkIn.time).toLocaleString() : "", 
                    Status: a.status, WorkingHours: a.workingHours ? a.workingHours + " hrs" : "N/A" 
                }));
                break;
            case "shifts":
                const shifts = await getShifts({ date: { $gte: start, $lte: end } });
                data = shifts.map((s) => ({ 
                    Guard: s.guardUser?.name, BadgeNumber: s.guardUser?.badgeNumber, 
                    Supervisor: s.supervisorUser?.name, Date: s.date ? new Date(s.date).toLocaleDateString() : "", 
                    StartTime: s.startTime, EndTime: s.endTime, Zone: s.zone, Status: s.status, 
                    Overtime: s.overtime ? s.overtime + " hrs" : "0" 
                }));
                break;
            default: return res.status(400).json({ error: "Invalid report type" });
        }

        if (format === "csv") {
            const csv = new Parser().parse(data);
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`);
            return res.send(csv);
        }
        if (format === "json") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=${filename}.json`);
            return res.json(data);
        }
        return res.status(400).json({ error: "Invalid export format" });
    } catch (err) {
        console.error("❌ Export error:", err);
        res.status(500).json({ error: "Failed to export report" });
    }
});

// ================== REPORTS API ==================

app.get("/api/reports/data", isAuthenticated, async (req, res) => {
    try {
        const { from, to } = req.query;
        const start = from ? new Date(from) : new Date(); 
        if (!from) start.setDate(start.getDate() - 30); 
        start.setHours(0, 0, 0, 0);
        const end = to ? new Date(to) : new Date(); 
        end.setHours(23, 59, 59, 999);
        
        const [incidents, patrols, attendance, shifts] = await Promise.all([
            getIncidents({ createdAt: { $gte: start, $lte: end } }),
            getPatrols({ startTime: { $gte: start, $lte: end } }),
            getAttendances({ date: { $gte: start, $lte: end } }),
            getShifts({ date: { $gte: start, $lte: end } }),
        ]);
        
        res.json({
            incidents: { 
                total: incidents.length, 
                bySeverity: { 
                    critical: incidents.filter((i) => i.severity === "critical").length, 
                    high: incidents.filter((i) => i.severity === "high").length, 
                    medium: incidents.filter((i) => i.severity === "medium").length, 
                    low: incidents.filter((i) => i.severity === "low").length 
                }, 
                byStatus: { 
                    reported: incidents.filter((i) => i.status === "reported").length, 
                    resolved: incidents.filter((i) => ["resolved","closed"].includes(i.status)).length 
                } 
            },
            patrols: { 
                total: patrols.length, 
                completed: patrols.filter((p) => p.status === "completed").length, 
                inProgress: patrols.filter((p) => p.status === "in_progress").length 
            },
            attendance: { 
                total: attendance.length, 
                present: attendance.filter((a) => a.status === "present").length, 
                late: attendance.filter((a) => a.status === "late").length 
            },
            shifts: { 
                total: shifts.length, 
                completed: shifts.filter((s) => s.status === "completed").length, 
                overtime: shifts.reduce((sum, s) => sum + (s.overtime || 0), 0) 
            },
        });
    } catch (err) {
        console.error("❌ API data error:", err);
        res.status(500).json({ error: "Failed to fetch report data" });
    }
});

app.get("/api/reports/:type", isAuthenticated, async (req, res) => {
    try {
        const { type } = req.params;
        const { from, to } = req.query;
        const start = from ? new Date(from) : new Date(); 
        if (!from) start.setDate(start.getDate() - 30); 
        start.setHours(0, 0, 0, 0);
        const end = to ? new Date(to) : new Date(); 
        end.setHours(23, 59, 59, 999);
        let data = {};

        switch (type) {
            case "incidents": {
                const incidents = await getIncidents({ createdAt: { $gte: start, $lte: end } });
                data = { 
                    total: incidents.length, 
                    bySeverity: { 
                        critical: incidents.filter((i) => i.severity === "critical").length, 
                        high: incidents.filter((i) => i.severity === "high").length, 
                        medium: incidents.filter((i) => i.severity === "medium").length, 
                        low: incidents.filter((i) => i.severity === "low").length 
                    }, 
                    byStatus: { 
                        reported: incidents.filter((i) => i.status === "reported").length, 
                        acknowledged: incidents.filter((i) => i.status === "acknowledged").length, 
                        investigating: incidents.filter((i) => i.status === "investigating").length, 
                        inProgress: incidents.filter((i) => i.status === "in_progress").length, 
                        resolved: incidents.filter((i) => ["resolved","closed"].includes(i.status)).length 
                    }, 
                    timeline: await getTimelineData(prisma.incident, start, end) 
                };
                break;
            }
            case "patrols": {
                const patrols = await getPatrols({ startTime: { $gte: start, $lte: end } });
                data = { 
                    total: patrols.length, 
                    completed: patrols.filter((p) => p.status === "completed").length, 
                    inProgress: patrols.filter((p) => p.status === "in_progress").length, 
                    scheduled: patrols.filter((p) => p.status === "scheduled").length, 
                    missed: patrols.filter((p) => p.status === "missed").length, 
                    avgDuration: calculateAverageDuration(patrols) 
                };
                break;
            }
            case "guards": {
                const allGuards = await prisma.user.findMany({ where: { role: "guard" } });
                const active = allGuards.filter((g) => g.isActive).length;
                const performance = await Promise.all(allGuards.slice(0, 10).map(async (g) => ({ 
                    name: g.name || `${g.firstName} ${g.lastName}`, 
                    patrols: await countPatrols({ guard: g.id, startTime: { $gte: start, $lte: end } }), 
                    incidents: await countIncidents({ assignedTo: { has: g.id }, createdAt: { $gte: start, $lte: end } }) 
                })));
                data = { 
                    total: allGuards.length, 
                    active, 
                    inactive: allGuards.length - active, 
                    newThisMonth: allGuards.filter((g) => g.createdAt >= start && g.createdAt <= end).length, 
                    performance 
                };
                break;
            }
            case "attendance": {
                const attendance = await getAttendances({ date: { $gte: start, $lte: end } });
                const present = attendance.filter((a) => a.status === "present").length;
                const late = attendance.filter((a) => a.status === "late").length;
                data = { 
                    total: attendance.length, 
                    present, 
                    late, 
                    absent: attendance.filter((a) => a.status === "absent").length, 
                    rate: attendance.length > 0 ? Math.round((present / attendance.length) * 100) : 0, 
                    daily: await getDailyAttendance(start, end) 
                };
                break;
            }
            case "shifts": {
                const shifts = await getShifts({ date: { $gte: start, $lte: end } });
                data = { 
                    total: shifts.length, 
                    completed: shifts.filter((s) => s.status === "completed").length, 
                    inProgress: shifts.filter((s) => s.status === "in_progress").length, 
                    scheduled: shifts.filter((s) => s.status === "scheduled").length, 
                    missed: shifts.filter((s) => s.status === "missed").length, 
                    overtime: shifts.reduce((sum, s) => sum + (s.overtime || 0), 0), 
                    byZone: await getShiftsByZone(shifts) 
                };
                break;
            }
            case "compliance": {
                const patrolsC = await getPatrols({ startTime: { $gte: start, $lte: end } });
                let completed = 0, total = 0;
                patrolsC.forEach((p) => { 
                    if (p.checkpoints && Array.isArray(p.checkpoints)) { 
                        total += p.checkpoints.length; 
                        completed += p.checkpoints.filter((c) => c.status === "completed").length; 
                    } 
                });
                data = { 
                    complianceRate: total > 0 ? Math.round((completed / total) * 100) : 0, 
                    totalChecks: total, 
                    completedChecks: completed, 
                    missedChecks: total - completed, 
                    byGuard: await getGuardCompliance(patrolsC) 
                };
                break;
            }
            default: return res.status(400).json({ error: "Invalid report type" });
        }
        res.json(data);
    } catch (err) {
        console.error("❌ API report error:", err);
        res.status(500).json({ error: "Failed to fetch report data" });
    }
});

// ================== ZONES ==================

app.get("/zones/:zone", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const decodedZone = decodeURIComponent(req.params.zone);
        
        const incidents = await getIncidents({ "location.name": decodedZone });
        incidents.slice(0, 20);
        
        const patrols = await getPatrols({ "route.name": decodedZone });
        patrols.slice(0, 20);
        
        const shifts = await getShifts({ zone: decodedZone, date: { $gte: new Date() } });
        shifts.slice(0, 10);
        
        res.render("zone-details", {
            title: `${formatZone(decodedZone)} - Zone Details`, 
            layout: false,
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) },
            zone: decodedZone, 
            formattedZone: formatZone(decodedZone),
            incidents, patrols, shifts,
            incidentCount: incidents.length, 
            patrolCount: patrols.length, 
            activeGuards: shifts.length,
        });
    } catch (err) {
        console.error("❌ Zone details error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading zone details", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

// ================== PATROLS ROUTES ==================

app.get("/patrols", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const endDate = req.query.end ? new Date(req.query.end) : new Date();
        const startDate = req.query.start ? new Date(req.query.start) : new Date(endDate);
        if (!req.query.start) startDate.setHours(0, 0, 0, 0);
        const start = new Date(startDate); start.setHours(0, 0, 0, 0);
        const end = new Date(endDate); end.setHours(23, 59, 59, 999);

        const patrolFilter = { startTime: { $gte: start, $lte: end } };
        if (req.session.userRole === "guard") patrolFilter.guard = req.session.userId;

        const patrols = await getPatrols(patrolFilter);
        const guards = await prisma.user.findMany({
            where: { role: "guard", isActive: true },
            select: { id: true, name: true, firstName: true, lastName: true }
        });
        const checkpoints = await getCheckpoints({ isActive: true });
        const activePatrols = await getPatrols({ status: "in_progress", startTime: { $gte: start } });

        const totalPatrols = patrols.length;
        const activePatrolsCount = await countPatrols({ status: "in_progress", startTime: { $gte: new Date(Date.now() - 86400000) } });
        const completedToday = patrols.filter((p) => p.status === "completed" && p.endTime && new Date(p.endTime) >= start && new Date(p.endTime) <= end).length;
        const scheduledToday = patrols.filter((p) => p.status === "scheduled" && new Date(p.startTime) >= start && new Date(p.startTime) <= end).length;
        const completedPatrols = patrols.filter((p) => p.status === "completed").length;
        const completionRate = totalPatrols > 0 ? Math.round((completedPatrols / totalPatrols) * 100) : 0;
        const avgDuration = calculateAverageDuration(patrols.filter((p) => p.startTime && p.endTime));
        let totalDistance = 0;
        patrols.forEach((p) => { if (p.stats?.distance) totalDistance += p.stats.distance; });
        let totalCheckpoints = 0, completedCheckpoints = 0;
        patrols.forEach((p) => { 
            if (p.checkpoints && Array.isArray(p.checkpoints)) { 
                totalCheckpoints += p.checkpoints.length; 
                completedCheckpoints += p.checkpoints.filter((c) => c.status === "completed").length; 
            } 
        });
        const checkpointCoverage = totalCheckpoints > 0 ? Math.round((completedCheckpoints / totalCheckpoints) * 100) : 0;
        const onDutyGuards = await countUsers({ role: "guard", isActive: true, lastLogin: { $gte: new Date(Date.now() - 1800000) } });

        const enhancedPatrols = patrols.map((patrol) => {
            const obj = { ...patrol };
            if (patrol.guardUser) obj.guard = { ...patrol.guardUser, initials: getInitials(patrol.guardUser.name || `${patrol.guardUser.firstName} ${patrol.guardUser.lastName}`) };
            if (patrol.startTime && patrol.endTime) obj.duration = Math.round((new Date(patrol.endTime) - new Date(patrol.startTime)) / 60000);
            obj.totalCheckpoints = patrol.checkpoints?.length || 0;
            obj.completedCheckpoints = patrol.checkpoints?.filter((c) => c.status === "completed").length || 0;
            obj.checkpointPercentage = obj.totalCheckpoints > 0 ? Math.round((obj.completedCheckpoints / obj.totalCheckpoints) * 100) : 0;
            obj.zone = patrol.route?.name || patrol.shift?.zone || "unknown";
            obj.distance = patrol.stats?.distance ? patrol.stats.distance.toFixed(1) : null;
            return obj;
        });

        res.render("patrols", {
            title: "Patrol Management - Campus Guard Connect", 
            layout: false,
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) },
            notificationCount: res.locals.notificationCount || 0,
            stats: { 
                totalPatrols, periodPatrols: patrols.length, activePatrols: activePatrolsCount, 
                onDutyGuards, completionRate, completedToday, scheduledToday, avgDuration, 
                totalDistance: totalDistance.toFixed(1), checkpointsCovered: checkpointCoverage, 
                totalCheckpoints, completedCheckpoints 
            },
            patrols: enhancedPatrols,
            guards: guards.map((g) => ({ _id: g.id, name: g.name || `${g.firstName} ${g.lastName}` })),
            checkpoints, 
            activePatrols: activePatrols.map((p) => ({ ...p, guardName: p.guardUser?.name || `${p.guardUser?.firstName} ${p.guardUser?.lastName}` })),
            dateRange: { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] },
        });
    } catch (err) {
        console.error("❌ Patrols page error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading patrols page", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

app.get("/api/patrols/active", isAuthenticated, async (req, res) => {
    try {
        const activePatrols = await getPatrols({ status: "in_progress" });
        const result = activePatrols.map((patrol) => ({
            ...patrol,
            guardName: patrol.guardUser?.name || `${patrol.guardUser?.firstName} ${patrol.guardUser?.lastName}`,
            currentLocation: patrol.path?.length ? patrol.path[patrol.path.length - 1]?.location : null,
            lastUpdate: patrol.path?.length ? patrol.path[patrol.path.length - 1]?.timestamp : null
        }));
        res.json({ active: result.length, patrols: result });
    } catch (err) {
        console.error("❌ Active patrols error:", err);
        res.status(500).json({ error: "Failed to fetch active patrols" });
    }
});

app.get("/api/patrols", isAuthenticated, async (req, res) => {
    try {
        const { from, to } = req.query;
        const start = from ? new Date(from) : new Date(); 
        if (!from) start.setHours(0, 0, 0, 0);
        const end = to ? new Date(to) : new Date(); 
        end.setHours(23, 59, 59, 999);
        const filter = { startTime: { $gte: start, $lte: end } };
        if (req.session.userRole === "guard") filter.guard = req.session.userId;
        const patrols = await getPatrols(filter);
        res.json(patrols);
    } catch (err) {
        console.error("❌ API patrols error:", err);
        res.status(500).json({ error: "Failed to fetch patrols" });
    }
});

app.get("/api/patrols/:id", isAuthenticated, async (req, res) => {
    try {
        const patrol = await getPatrolById(req.params.id);
        if (!patrol) return res.status(404).json({ error: "Patrol not found" });
        
        const result = {
            ...patrol,
            guard: patrol.guardUser,
            guardInitials: getInitials(patrol.guardUser?.name || `${patrol.guardUser?.firstName} ${patrol.guardUser?.lastName}`),
            duration: patrol.startTime && patrol.endTime ? Math.round((new Date(patrol.endTime) - new Date(patrol.startTime)) / 60000) : null,
            zone: patrol.route?.name || patrol.shift?.zone,
            distance: patrol.stats?.distance ? patrol.stats.distance.toFixed(1) : null
        };
        res.json(result);
    } catch (err) {
        console.error("❌ API patrol error:", err);
        res.status(500).json({ error: "Failed to fetch patrol" });
    }
});

app.post("/patrols/start", isAuthenticated, hasRole(["guard", "supervisor", "admin"]), async (req, res) => {
    try {
        const { route, duration, notes } = req.body;
        const existing = await getPatrols({ guard: req.session.userId, status: "in_progress" });
        if (existing.length > 0) return res.status(400).json({ error: "You already have an active patrol. Please complete it first." });
        
        const scheduledEndTime = new Date();
        scheduledEndTime.setMinutes(scheduledEndTime.getMinutes() + parseInt(duration || 60));
        
        const patrol = await createPatrol({
            guard: req.session.userId,
            supervisor: req.session.userRole === "guard" ? null : req.session.userId,
            startTime: new Date(),
            scheduledEndTime,
            status: "in_progress",
            route: { name: route, waypoints: [] },
            path: [{ location: req.body.location || [0, 0], timestamp: new Date() }],
            notes: notes || "",
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "START_PATROL",
                category: "patrol",
                description: `Started new patrol in zone: ${route}`,
                targetId: patrol.id,
                targetModel: "Patrol",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        try {
            const supervisors = await prisma.user.findMany({ where: { role: "supervisor" } });
            for (const sup of supervisors) {
                await createNotification({
                    recipient: sup.id,
                    type: "info",
                    title: "Patrol Started",
                    message: `Guard started a new patrol in zone: ${route}`,
                    relatedTo: { model: "Patrol", id: patrol.id },
                    priority: "medium"
                });
            }
        } catch (_) {}
        
        res.json({ success: true, message: "Patrol started successfully", patrolId: patrol.id });
    } catch (err) {
        console.error("❌ Start patrol error:", err);
        res.status(500).json({ success: false, message: "Failed to start patrol", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/api/patrols/:id/location", isAuthenticated, async (req, res) => {
    try {
        const { location, accuracy, speed } = req.body;
        const patrol = await getPatrolById(req.params.id);
        if (!patrol) return res.status(404).json({ error: "Patrol not found" });
        if (patrol.guard !== req.session.userId) return res.status(403).json({ error: "Unauthorized" });
        
        const currentPath = patrol.path || [];
        currentPath.push({ location, timestamp: new Date(), accuracy: accuracy || null, speed: speed || null });
        await updatePatrol(req.params.id, { path: currentPath });
        
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Location update error:", err);
        res.status(500).json({ error: "Failed to update location" });
    }
});

app.post("/patrols/:id/complete", isAuthenticated, async (req, res) => {
    try {
        const patrol = await getPatrolById(req.params.id);
        if (!patrol) return res.status(404).json({ error: "Patrol not found" });
        if (patrol.guard !== req.session.userId && !["admin","supervisor"].includes(req.session.userRole)) {
            return res.status(403).json({ error: "Unauthorized" });
        }
        
        const endTime = new Date();
        const duration = (endTime - new Date(patrol.startTime)) / 60000;
        let distance = 0;
        if (patrol.path && patrol.path.length > 1) {
            for (let i = 1; i < patrol.path.length; i++) {
                const prev = patrol.path[i - 1].location, curr = patrol.path[i].location;
                distance += Math.sqrt(Math.pow(curr[0] - prev[0], 2) + Math.pow(curr[1] - prev[1], 2)) * 111;
            }
        }
        const totalCp = patrol.checkpoints?.length || 0;
        const completedCp = patrol.checkpoints?.filter((c) => c.status === "completed").length || 0;
        
        await updatePatrol(req.params.id, {
            endTime,
            status: "completed",
            stats: { 
                distance, 
                duration: Math.round(duration), 
                efficiency: totalCp > 0 ? Math.round((completedCp / totalCp) * 100) : 0, 
                coverage: patrol.checkpoints?.length || 0 
            }
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "COMPLETE_PATROL",
                category: "patrol",
                description: `Completed patrol in zone: ${patrol.route?.name || "Unknown"}`,
                targetId: patrol.id,
                targetModel: "Patrol",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Patrol completed successfully", stats: { distance, duration: Math.round(duration) } });
    } catch (err) {
        console.error("❌ Complete patrol error:", err);
        res.status(500).json({ error: "Failed to complete patrol" });
    }
});

app.post("/patrols/:id/interrupt", isAuthenticated, async (req, res) => {
    try {
        const { reason } = req.body;
        const patrol = await getPatrolById(req.params.id);
        if (!patrol) return res.status(404).json({ error: "Patrol not found" });
        if (patrol.guard !== req.session.userId && !["admin","supervisor"].includes(req.session.userRole)) {
            return res.status(403).json({ error: "Unauthorized" });
        }
        
        await updatePatrol(req.params.id, {
            status: "interrupted",
            endTime: new Date(),
            notes: (patrol.notes || "") + `\nInterrupted: ${reason || "No reason provided"}`
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "INTERRUPT_PATROL",
                category: "patrol",
                description: `Patrol interrupted: ${reason || "No reason"}`,
                targetId: patrol.id,
                targetModel: "Patrol",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Patrol interrupted" });
    } catch (err) {
        console.error("❌ Interrupt patrol error:", err);
        res.status(500).json({ error: "Failed to interrupt patrol" });
    }
});

app.post("/api/patrols/:id/scan", isAuthenticated, async (req, res) => {
    try {
        const { checkpointCode } = req.body;
        const checkpoint = await getCheckpointByCode(checkpointCode);
        if (!checkpoint) return res.status(404).json({ error: "Invalid checkpoint code" });
        
        const patrol = await getPatrolById(req.params.id);
        if (!patrol) return res.status(404).json({ error: "Patrol not found" });
        if (patrol.guard !== req.session.userId) return res.status(403).json({ error: "Unauthorized" });
        if (patrol.status !== "in_progress") return res.status(400).json({ error: "Patrol is not in progress" });
        
        const checkpointsList = patrol.checkpoints || [];
        const existing = checkpointsList.find((c) => c.name === checkpoint.name);
        if (existing) {
            existing.scannedAt = new Date();
            existing.scannedBy = req.session.userId;
            existing.status = "completed";
        } else {
            checkpointsList.push({
                name: checkpoint.name,
                location: checkpoint.location,
                qrCode: checkpoint.code,
                scannedAt: new Date(),
                scannedBy: req.session.userId,
                status: "completed"
            });
        }
        
        await updatePatrol(req.params.id, { checkpoints: checkpointsList });
        await prisma.checkpoint.update({
            where: { id: checkpoint.id },
            data: { lastScanned: new Date(), lastScannedBy: req.session.userId }
        });
        
        const total = checkpointsList.length;
        const completed = checkpointsList.filter((c) => c.status === "completed").length;
        res.json({ 
            success: true, 
            message: "Checkpoint scanned successfully", 
            checkpoint: checkpoint.name, 
            progress: total > 0 ? Math.round((completed / total) * 100) : 0, 
            completed, 
            total 
        });
    } catch (err) {
        console.error("❌ Scan checkpoint error:", err);
        res.status(500).json({ error: "Failed to scan checkpoint" });
    }
});

app.get("/patrols/track/:id", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const patrol = await getPatrolById(req.params.id);
        if (!patrol) return res.status(404).render("error", { title: "Not Found", message: "Patrol not found", error: {} });
        
        if (patrol.guard !== req.session.userId && !["admin","supervisor"].includes(req.session.userRole)) {
            return res.status(403).render("error", { title: "Access Denied", message: "You don't have permission to view this patrol", error: {} });
        }
        
        const checkpoints = await getCheckpoints({ zone: patrol.route?.name || patrol.shift?.zone, isActive: true });
        
        res.render("track-patrol", { 
            title: "Track Patrol - Campus Guard Connect", 
            layout: false, 
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) }, 
            patrol, 
            checkpoints, 
            notificationCount: res.locals.notificationCount || 0 
        });
    } catch (err) {
        console.error("❌ Track patrol error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading patrol tracking", error: {} });
    }
});

app.get("/patrols/export", isAuthenticated, hasRole(["admin", "supervisor"]), async (req, res) => {
    try {
        const { format, from, to } = req.query;
        const { Parser } = require("json2csv");
        const start = from ? new Date(from) : new Date(); 
        if (!from) start.setHours(0, 0, 0, 0);
        const end = to ? new Date(to) : new Date(); 
        end.setHours(23, 59, 59, 999);
        
        const patrols = await getPatrols({ startTime: { $gte: start, $lte: end } });
        const exportData = patrols.map((p) => ({ 
            ID: p.id, Guard: p.guardUser?.name || "Unknown", 
            BadgeNumber: p.guardUser?.badgeNumber || "N/A", Supervisor: p.supervisorUser?.name || "N/A", 
            Zone: p.route?.name || p.shift?.zone || "Unknown", 
            StartTime: p.startTime ? new Date(p.startTime).toLocaleString() : "N/A", 
            EndTime: p.endTime ? new Date(p.endTime).toLocaleString() : "In Progress", 
            Duration: p.endTime ? Math.round((new Date(p.endTime) - new Date(p.startTime)) / 60000) + " min" : "N/A", 
            Status: p.status, 
            CheckpointsCompleted: p.checkpoints?.filter((c) => c.status === "completed").length || 0, 
            TotalCheckpoints: p.checkpoints?.length || 0, 
            Notes: p.notes || "" 
        }));
        
        const filename = `patrols-export-${start.toISOString().split("T")[0]}-to-${end.toISOString().split("T")[0]}`;
        if (format === "csv") { 
            const csv = new Parser().parse(exportData); 
            res.setHeader("Content-Type", "text/csv"); 
            res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`); 
            return res.send(csv); 
        }
        if (format === "json") { 
            res.setHeader("Content-Type", "application/json"); 
            res.setHeader("Content-Disposition", `attachment; filename=${filename}.json`); 
            return res.json(exportData); 
        }
        return res.status(400).json({ error: "Invalid export format" });
    } catch (err) {
        console.error("❌ Export error:", err);
        res.status(500).json({ error: "Failed to export patrols" });
    }
});

app.get("/patrols/report/:id", isAuthenticated, async (req, res) => {
    try {
        const { format } = req.query;
        const patrol = await getPatrolById(req.params.id);
        if (!patrol) return res.status(404).json({ error: "Patrol not found" });
        
        const reportData = { 
            patrolId: patrol.id, 
            guard: patrol.guardUser?.name || "Unknown", 
            badgeNumber: patrol.guardUser?.badgeNumber || "N/A", 
            supervisor: patrol.supervisorUser?.name || "N/A", 
            startTime: patrol.startTime ? new Date(patrol.startTime).toLocaleString() : "N/A", 
            endTime: patrol.endTime ? new Date(patrol.endTime).toLocaleString() : "In Progress", 
            duration: patrol.endTime ? Math.round((new Date(patrol.endTime) - new Date(patrol.startTime)) / 60000) + " minutes" : "In Progress", 
            zone: patrol.route?.name || patrol.shift?.zone || "Unknown", 
            status: patrol.status, 
            checkpoints: patrol.checkpoints?.map((c) => ({ 
                name: c.name, 
                scannedAt: c.scannedAt ? new Date(c.scannedAt).toLocaleString() : "Not scanned", 
                status: c.status 
            })) || [], 
            stats: patrol.stats || {}, 
            notes: patrol.notes || "No notes" 
        };
        
        if (format === "json") { 
            res.setHeader("Content-Type", "application/json"); 
            res.setHeader("Content-Disposition", `attachment; filename=patrol-${patrol.id}.json`); 
            return res.json(reportData); 
        }
        return res.render("patrol-report", { title: "Patrol Report", layout: false, patrol: reportData, user: res.locals.currentUser });
    } catch (err) {
        console.error("❌ Patrol report error:", err);
        res.status(500).json({ error: "Failed to generate report" });
    }
});

app.get("/patrols/edit/:id", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const patrol = await getPatrolById(req.params.id);
        if (!patrol) return res.status(404).render("error", { title: "Not Found", message: "Patrol not found", error: {} });
        
        const guards = await prisma.user.findMany({
            where: { role: "guard", isActive: true },
            select: { id: true, name: true, firstName: true, lastName: true }
        });
        
        res.render("edit-patrol", { 
            title: "Edit Patrol - Campus Guard Connect", 
            layout: false, 
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) }, 
            patrol, 
            guards, 
            notificationCount: res.locals.notificationCount || 0 
        });
    } catch (err) {
        console.error("❌ Edit patrol error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading edit page", error: {} });
    }
});

app.put("/patrols/:id", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { guard, status, notes } = req.body;
        const patrol = await updatePatrol(req.params.id, { guard, status, notes });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "UPDATE_PATROL",
                category: "patrol",
                description: `Updated patrol ${patrol.id}`,
                targetId: patrol.id,
                targetModel: "Patrol",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, patrol });
    } catch (err) {
        console.error("❌ Update patrol error:", err);
        res.status(500).json({ error: "Failed to update patrol" });
    }
});

// ================== GUARDS ROUTES ==================

app.get("/guards", isAuthenticated, hasRole(["admin", "supervisor"]), async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const guards = await prisma.user.findMany({
            where: { role: "guard" },
            orderBy: { createdAt: 'desc' }
        });
        
        const fiveMinutesAgo = new Date(Date.now() - 300000);
        const now = new Date(); 
        const today = new Date(now); 
        today.setHours(0, 0, 0, 0);

        const enhancedGuards = await Promise.all(guards.map(async (guard) => {
            const currentShift = await prisma.shift.findFirst({
                where: { 
                    guard: guard.id, 
                    date: { gte: today }, 
                    status: { in: ["scheduled", "in_progress"] } 
                },
                orderBy: { date: 'asc' }
            });
            const todayPatrols = await countPatrols({ guard: guard.id, startTime: { $gte: today } });
            const isOnline = guard.lastLogin && new Date(guard.lastLogin) > fiveMinutesAgo;
            let currentZone = currentShift?.zone || null;
            if (!currentZone) {
                const latestPatrol = await prisma.patrol.findFirst({
                    where: { guard: guard.id, status: "in_progress" },
                    orderBy: { startTime: 'desc' }
                });
                if (latestPatrol) currentZone = latestPatrol.route?.name;
            }
            return { 
                _id: guard.id, 
                name: guard.name || `${guard.firstName} ${guard.lastName}`, 
                firstName: guard.firstName, 
                lastName: guard.lastName, 
                email: guard.email, 
                badgeNumber: guard.badgeNumber || "N/A", 
                phoneNumber: guard.phoneNumber || "N/A", 
                role: guard.role, 
                isActive: guard.isActive, 
                isOnline, 
                createdAt: guard.createdAt, 
                lastLogin: guard.lastLogin, 
                currentShift: currentShift ? { date: currentShift.date, start: currentShift.startTime, end: currentShift.endTime, zone: currentShift.zone } : null, 
                currentZone, 
                patrolsToday: todayPatrols, 
                initials: getInitials(guard.name || `${guard.firstName} ${guard.lastName}`) 
            };
        }));

        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
        const stats = { 
            totalGuards: enhancedGuards.length, 
            activeGuards: enhancedGuards.filter((g) => g.isActive).length, 
            onlineGuards: enhancedGuards.filter((g) => g.isOnline).length, 
            onDuty: enhancedGuards.filter((g) => g.currentShift).length, 
            onLeave: enhancedGuards.filter((g) => !g.isActive).length, 
            newThisMonth: enhancedGuards.filter((g) => g.createdAt >= thirtyDaysAgo).length 
        };

        const zoneDistribution = {};
        enhancedGuards.forEach((g) => { if (g.currentZone) zoneDistribution[g.currentZone] = (zoneDistribution[g.currentZone] || 0) + 1; });

        const lastGuard = await prisma.user.findFirst({
            where: { role: "guard" },
            orderBy: { createdAt: 'desc' }
        });
        let nextBadgeNumber = "GC-001";
        if (lastGuard?.badgeNumber) { 
            const match = lastGuard.badgeNumber.match(/\d+/); 
            if (match) nextBadgeNumber = `GC-${String(parseInt(match[0]) + 1).padStart(3, "0")}`; 
        }

        res.render("guards", { 
            title: "Guard Management - Campus Guard Connect", 
            layout: false, 
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) }, 
            notificationCount: res.locals.notificationCount || 0, 
            guards: enhancedGuards, 
            stats, 
            zoneStats: Object.values(zoneDistribution), 
            nextBadgeNumber, 
            year: new Date().getFullYear() 
        });
    } catch (err) {
        console.error("❌ Guards page error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading guards page", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

app.post("/guards/add", isAuthenticated, hasRole(["admin", "supervisor"]), async (req, res) => {
    try {
        const { firstName, lastName, email, phoneNumber, badgeNumber, role, shiftMorning, shiftAfternoon, shiftNight, emergencyName, emergencyRelationship, emergencyPhone } = req.body;
        const errors = [];
        const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
        
        if (!firstName?.trim()) errors.push({ msg: "First name is required", field: "firstName" });
        if (!lastName?.trim()) errors.push({ msg: "Last name is required", field: "lastName" });
        if (!email || !emailRegex.test(email)) errors.push({ msg: "Please enter a valid email", field: "email" });
        else { 
            const existing = await getUserByEmail(email.toLowerCase()); 
            if (existing) errors.push({ msg: "Email already exists", field: "email" }); 
        }
        if (!badgeNumber) errors.push({ msg: "Badge number is required", field: "badgeNumber" });
        else { 
            const existing = await prisma.user.findUnique({ where: { badgeNumber: badgeNumber.toUpperCase() } }); 
            if (existing) errors.push({ msg: "Badge number already exists", field: "badgeNumber" }); 
        }
        if (errors.length > 0) return res.status(400).json({ errors });

        const defaultPassword = Math.random().toString(36).slice(-8) + "1A!";
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(defaultPassword, salt);
        const preferredShifts = [shiftMorning && "morning", shiftAfternoon && "afternoon", shiftNight && "night"].filter(Boolean);
        
        const newGuard = await createUser({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: role || "guard",
            badgeNumber: badgeNumber.toUpperCase().trim(),
            phoneNumber: phoneNumber || "",
            isActive: true,
            shiftPreferences: { preferredShifts, maxHoursPerWeek: 40 },
            emergencyContact: { name: emergencyName || "", relationship: emergencyRelationship || "", phone: emergencyPhone || "" },
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "ADD_GUARD",
                category: "user",
                description: `Added new guard: ${newGuard.name}`,
                targetId: newGuard.id,
                targetModel: "User",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.status(201).json({ 
            success: true, 
            message: "Guard added successfully", 
            guard: { id: newGuard.id, name: newGuard.name, email: newGuard.email, password: defaultPassword } 
        });
    } catch (err) {
        console.error("❌ Add guard error:", err);
        res.status(500).json({ success: false, message: "Failed to add guard", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.get("/api/guards/:id", isAuthenticated, async (req, res) => {
    try {
        const guard = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, firstName: true, lastName: true, name: true, email: true,
                badgeNumber: true, phoneNumber: true, isActive: true, lastLogin: true,
                createdAt: true, shiftPreferences: true, emergencyContact: true
            }
        });
        
        if (!guard) return res.status(404).json({ error: "Guard not found" });
        
        const result = { ...guard, initials: getInitials(guard.name || `${guard.firstName} ${guard.lastName}`) };
        const today = new Date(); today.setHours(0, 0, 0, 0);
        
        result.currentShift = await prisma.shift.findFirst({
            where: { guard: guard.id, date: { gte: today }, status: { in: ["scheduled", "in_progress"] } },
            include: { supervisorUser: { select: { name: true } } }
        });
        
        result.recentPatrols = await getPatrols({ guard: guard.id });
        result.recentIncidents = await getIncidents({ $or: [{ reportedBy: guard.id }, { assignedTo: { has: guard.id } }] });
        
        res.json(result);
    } catch (err) {
        console.error("❌ API guard error:", err);
        res.status(500).json({ error: "Failed to fetch guard" });
    }
});

app.get("/guards/edit/:id", isAuthenticated, hasRole(["admin", "supervisor"]), async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const guard = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, firstName: true, lastName: true, name: true, email: true,
                badgeNumber: true, phoneNumber: true, role: true, isActive: true,
                shiftPreferences: true, emergencyContact: true
            }
        });
        if (!guard) return res.status(404).render("error", { title: "Not Found", message: "Guard not found", error: {} });
        
        res.render("edit-guard", { 
            title: "Edit Guard - Campus Guard Connect", 
            layout: false, 
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) }, 
            guard, 
            notificationCount: res.locals.notificationCount || 0 
        });
    } catch (err) {
        console.error("❌ Edit guard page error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading edit page", error: {} });
    }
});

app.put("/guards/:id", isAuthenticated, hasRole(["admin", "supervisor"]), async (req, res) => {
    try {
        const { firstName, lastName, email, phoneNumber, badgeNumber, role, isActive, shiftMorning, shiftAfternoon, shiftNight, emergencyName, emergencyRelationship, emergencyPhone } = req.body;
        const errors = [];
        const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
        
        if (!firstName?.trim()) errors.push({ msg: "First name is required", field: "firstName" });
        if (!lastName?.trim()) errors.push({ msg: "Last name is required", field: "lastName" });
        if (!email || !emailRegex.test(email)) errors.push({ msg: "Please enter a valid email", field: "email" });
        else { 
            const ex = await prisma.user.findFirst({ where: { email: email.toLowerCase(), NOT: { id: req.params.id } } });
            if (ex) errors.push({ msg: "Email already exists", field: "email" }); 
        }
        if (!badgeNumber) errors.push({ msg: "Badge number is required", field: "badgeNumber" });
        else { 
            const ex = await prisma.user.findFirst({ where: { badgeNumber: badgeNumber.toUpperCase(), NOT: { id: req.params.id } } });
            if (ex) errors.push({ msg: "Badge number already exists", field: "badgeNumber" }); 
        }
        if (errors.length > 0) return res.status(400).json({ errors });
        
        const preferredShifts = [shiftMorning && "morning", shiftAfternoon && "afternoon", shiftNight && "night"].filter(Boolean);
        const updated = await updateUser(req.params.id, {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: email.toLowerCase().trim(),
            role: role || "guard",
            badgeNumber: badgeNumber.toUpperCase().trim(),
            phoneNumber: phoneNumber || "",
            isActive: isActive === "true" || isActive === true,
            shiftPreferences: { preferredShifts, maxHoursPerWeek: 40 },
            emergencyContact: { name: emergencyName || "", relationship: emergencyRelationship || "", phone: emergencyPhone || "" }
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "UPDATE_GUARD",
                category: "user",
                description: `Updated guard: ${updated.name}`,
                targetId: updated.id,
                targetModel: "User",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Guard updated successfully", guard: updated });
    } catch (err) {
        console.error("❌ Update guard error:", err);
        res.status(500).json({ success: false, message: "Failed to update guard", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.delete("/guards/:id", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const guard = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (!guard) return res.status(404).json({ error: "Guard not found" });
        
        const activeShift = await prisma.shift.findFirst({
            where: { guard: guard.id, status: { in: ["scheduled", "in_progress"] } }
        });
        if (activeShift) return res.status(400).json({ error: "Cannot delete guard with active shifts. Please reassign shifts first." });
        
        await updateUser(req.params.id, { isActive: false });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "DELETE_GUARD",
                category: "user",
                description: `Deactivated guard: ${guard.name}`,
                targetId: guard.id,
                targetModel: "User",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Guard deactivated successfully" });
    } catch (err) {
        console.error("❌ Delete guard error:", err);
        res.status(500).json({ success: false, message: "Failed to delete guard", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.get("/guards/export", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { format } = req.query;
        const { Parser } = require("json2csv");
        const guards = await prisma.user.findMany({
            where: { role: "guard" },
            select: {
                name: true, email: true, badgeNumber: true, phoneNumber: true,
                role: true, isActive: true, lastLogin: true, createdAt: true,
                shiftPreferences: true, emergencyContact: true
            }
        });
        
        const exportData = guards.map((g) => ({ 
            Name: g.name, Email: g.email, BadgeNumber: g.badgeNumber || "N/A", 
            Phone: g.phoneNumber || "N/A", Role: g.role, Status: g.isActive ? "Active" : "Inactive", 
            LastLogin: g.lastLogin ? new Date(g.lastLogin).toLocaleString() : "Never", 
            JoinedDate: g.createdAt ? new Date(g.createdAt).toLocaleString() : "", 
            PreferredShifts: g.shiftPreferences?.preferredShifts?.join(", ") || "None", 
            EmergencyContact: g.emergencyContact?.name || "None", 
            EmergencyPhone: g.emergencyContact?.phone || "None" 
        }));
        
        const filename = `guards-export-${new Date().toISOString().split("T")[0]}`;
        if (format === "csv") { 
            const csv = new Parser().parse(exportData); 
            res.setHeader("Content-Type", "text/csv"); 
            res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`); 
            return res.send(csv); 
        }
        if (format === "json") { 
            res.setHeader("Content-Type", "application/json"); 
            res.setHeader("Content-Disposition", `attachment; filename=${filename}.json`); 
            return res.json(exportData); 
        }
        return res.status(400).json({ error: "Invalid export format" });
    } catch (err) {
        console.error("❌ Export error:", err);
        res.status(500).json({ error: "Failed to export guards" });
    }
});

app.get("/api/guards/status", isAuthenticated, async (req, res) => {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 300000);
        const guards = await prisma.user.findMany({
            where: { role: "guard", isActive: true },
            select: { id: true, name: true, firstName: true, lastName: true, lastLogin: true }
        });
        res.json(guards.map((g) => ({ 
            id: g.id, 
            name: g.name || `${g.firstName} ${g.lastName}`, 
            online: g.lastLogin && new Date(g.lastLogin) > fiveMinutesAgo, 
            lastSeen: g.lastLogin 
        })));
    } catch (err) {
        console.error("❌ Guard status error:", err);
        res.status(500).json({ error: "Failed to fetch guard status" });
    }
});

app.post("/shifts/assign", isAuthenticated, hasRole(["admin", "supervisor"]), async (req, res) => {
    try {
        const { guardId, date, startTime, endTime, zone, notes } = req.body;
        if (!guardId || !date || !startTime || !endTime || !zone) return res.status(400).json({ error: "All fields are required" });
        
        const guard = await getUserById(guardId);
        if (!guard) return res.status(404).json({ error: "Guard not found" });
        
        const shiftDate = new Date(date); shiftDate.setHours(0, 0, 0, 0);
        const existing = await prisma.shift.findFirst({
            where: { guard: guardId, date: shiftDate, status: { not: "cancelled" } }
        });
        if (existing) return res.status(400).json({ error: "Guard already has a shift on this date" });
        
        const shift = await createShift({
            guard: guardId,
            supervisor: req.session.userId,
            date: shiftDate,
            startTime,
            endTime,
            zone,
            status: "scheduled",
            notes: notes || ""
        });
        
        try {
            await createNotification({
                recipient: guardId,
                type: "info",
                title: "New Shift Assigned",
                message: `You have been assigned a shift on ${new Date(date).toLocaleDateString()} from ${startTime} to ${endTime} at ${formatZone(zone)}`,
                relatedTo: { model: "Shift", id: shift.id },
                priority: "medium"
            });
        } catch (_) {}
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "ASSIGN_SHIFT",
                category: "shift",
                description: `Assigned shift to ${guard.name}`,
                targetId: shift.id,
                targetModel: "Shift",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Shift assigned successfully", shift });
    } catch (err) {
        console.error("❌ Assign shift error:", err);
        res.status(500).json({ success: false, message: "Failed to assign shift", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/guards/bulk-assign", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { guardIds, startDate, endDate, startTime, endTime, zone } = req.body;
        if (!guardIds?.length || !startDate || !endDate || !startTime || !endTime || !zone) {
            return res.status(400).json({ error: "All fields are required" });
        }
        
        const results = [], errors = [];
        const current = new Date(startDate), end = new Date(endDate);
        
        while (current <= end) {
            for (const guardId of guardIds) {
                try {
                    const existing = await prisma.shift.findFirst({
                        where: { guard: guardId, date: new Date(current), status: { not: "cancelled" } }
                    });
                    if (!existing) {
                        const shift = await createShift({
                            guard: guardId,
                            supervisor: req.session.userId,
                            date: new Date(current),
                            startTime,
                            endTime,
                            zone,
                            status: "scheduled"
                        });
                        results.push(shift.id);
                        
                        const guard = await getUserById(guardId);
                        if (guard) {
                            await createNotification({
                                recipient: guardId,
                                type: "info",
                                title: "Bulk Shift Assignment",
                                message: `You have been assigned shifts from ${startDate} to ${endDate}`,
                                priority: "medium"
                            });
                        }
                    }
                } catch (e) { 
                    errors.push({ guardId, date: current, error: e.message }); 
                }
            }
            current.setDate(current.getDate() + 1);
        }
        
        res.json({ success: true, message: `Created ${results.length} shifts with ${errors.length} errors`, results, errors });
    } catch (err) {
        console.error("❌ Bulk assign error:", err);
        res.status(500).json({ error: "Failed to bulk assign shifts" });
    }
});

// ================== USERS ROUTES (Admin Only) ==================

app.get("/admin/users", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' }
        });
        
        const enhancedUsers = await Promise.all(users.map(async (u) => {
            const activity = await getAuditLogs({ user: u.id });
            return {
                ...u,
                initials: getInitials(u.name || `${u.firstName} ${u.lastName}`),
                recentActivity: activity.slice(0, 5).map((a) => ({ action: a.action, description: a.description, timestamp: a.createdAt }))
            };
        }));
        
        const now = new Date(), thirtyMinutesAgo = new Date(now - 1800000), thirtyDaysAgo = new Date(now - 30 * 86400000);
        const stats = { 
            totalUsers: users.length, 
            activeUsers: users.filter((u) => u.isActive).length, 
            activePercentage: users.length > 0 ? Math.round((users.filter((u) => u.isActive).length / users.length) * 100) : 0, 
            guardCount: users.filter((u) => u.role === "guard").length, 
            supervisorCount: users.filter((u) => u.role === "supervisor").length, 
            adminCount: users.filter((u) => u.role === "admin").length, 
            studentCount: users.filter((u) => u.role === "student").length, 
            onlineNow: users.filter((u) => u.lastLogin && new Date(u.lastLogin) > thirtyMinutesAgo).length, 
            pendingUsers: users.filter((u) => !u.isActive).length, 
            newThisMonth: users.filter((u) => u.createdAt > thirtyDaysAgo).length 
        };
        
        const generatePassword = () => { 
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%"; 
            let p = ""; 
            for (let i = 0; i < 12; i++) p += chars.charAt(Math.floor(Math.random() * chars.length)); 
            return p; 
        };
        
        const lastGuard = await prisma.user.findFirst({
            where: { role: "guard" },
            orderBy: { createdAt: 'desc' }
        });
        let lastBadge = 0;
        if (lastGuard?.badgeNumber) { 
            const m = lastGuard.badgeNumber.match(/\d+/); 
            if (m) lastBadge = parseInt(m[0]); 
        }
        
        res.render("users", { 
            title: "User Management - Campus Guard Connect", 
            layout: false, 
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) }, 
            notificationCount: res.locals.notificationCount || 0, 
            users: enhancedUsers, 
            stats, 
            year: new Date().getFullYear(), 
            lastBadge: lastBadge + 1, 
            generatePassword: generatePassword() 
        });
    } catch (err) {
        console.error("❌ Users page error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading users page", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

app.post("/admin/users/add", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { firstName, lastName, email, phoneNumber, role, badgeNumber, institution, tempPassword } = req.body;
        const errors = [];
        const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
        
        if (!firstName?.trim()) errors.push({ msg: "First name is required", field: "firstName" });
        if (!lastName?.trim()) errors.push({ msg: "Last name is required", field: "lastName" });
        if (!email || !emailRegex.test(email)) errors.push({ msg: "Please enter a valid email", field: "email" });
        else { 
            const ex = await getUserByEmail(email.toLowerCase()); 
            if (ex) errors.push({ msg: "Email already exists", field: "email" }); 
        }
        if ((role === "guard" || role === "supervisor") && badgeNumber) { 
            const ex = await prisma.user.findUnique({ where: { badgeNumber: badgeNumber.toUpperCase() } }); 
            if (ex) errors.push({ msg: "Badge number already exists", field: "badgeNumber" }); 
        }
        if (errors.length > 0) return res.status(400).json({ errors });
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(tempPassword, salt);
        const userData = {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: role || "student",
            phoneNumber: phoneNumber || "",
            institution: institution || "",
            isActive: true
        };
        if ((role === "guard" || role === "supervisor") && badgeNumber) {
            userData.badgeNumber = badgeNumber.toUpperCase().trim();
        }
        
        const newUser = await createUser(userData);
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "ADD_USER",
                category: "user",
                description: `Added new user: ${newUser.name} (${newUser.role})`,
                targetId: newUser.id,
                targetModel: "User",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.status(201).json({ 
            success: true, 
            message: "User added successfully", 
            user: { id: newUser.id, name: newUser.name, email: newUser.email, tempPassword } 
        });
    } catch (err) {
        console.error("❌ Add user error:", err);
        res.status(500).json({ success: false, message: "Failed to add user", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.get("/api/users/search", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        
        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { email: { contains: q, mode: 'insensitive' } },
                    { badgeNumber: { contains: q.toUpperCase(), mode: 'insensitive' } },
                    { firstName: { contains: q, mode: 'insensitive' } },
                    { lastName: { contains: q, mode: 'insensitive' } }
                ]
            },
            select: { id: true, name: true, email: true, role: true, badgeNumber: true, firstName: true, lastName: true },
            take: 10
        });
        
        res.json(users.map((u) => ({ 
            id: u.id, 
            name: u.name, 
            email: u.email, 
            role: u.role, 
            badgeNumber: u.badgeNumber, 
            initials: getInitials(u.name || `${u.firstName} ${u.lastName}`) 
        })));
    } catch (err) {
        console.error("❌ Search error:", err);
        res.status(500).json({ error: "Failed to search users" });
    }
});

app.get("/api/users/online-status", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const online = await countUsers({ lastLogin: { $gte: new Date(Date.now() - 1800000) }, isActive: true });
        res.json({ online });
    } catch (err) {
        console.error("❌ Online status error:", err);
        res.status(500).json({ error: "Failed to fetch online status" });
    }
});

app.get("/api/users/:id", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, firstName: true, lastName: true, name: true, email: true,
                role: true, badgeNumber: true, phoneNumber: true, institution: true,
                profileImage: true, isActive: true, lastLogin: true, createdAt: true,
                updatedAt: true, timezone: true, notifications: true, privacy: true,
                accessibility: true, integrations: true, twoFactorEnabled: true,
                loginAlerts: true, emergencyContact: true, shiftPreferences: true
            }
        });
        
        if (!user) return res.status(404).json({ error: "User not found" });
        
        const result = { ...user, initials: getInitials(user.name || `${user.firstName} ${user.lastName}`) };
        const activity = await getAuditLogs({ user: user.id });
        result.recentActivity = activity.slice(0, 10).map((a) => ({ action: a.action, description: a.description, timestamp: a.createdAt }));
        
        if (user.role === "guard") {
            result.stats = {
                totalPatrols: await countPatrols({ guard: user.id }),
                completedPatrols: await countPatrols({ guard: user.id, status: "completed" }),
                incidentsAssigned: await countIncidents({ assignedTo: { has: user.id } }),
                incidentsReported: await countIncidents({ reportedBy: user.id })
            };
        }
        
        res.json(result);
    } catch (err) {
        console.error("❌ API user error:", err);
        res.status(500).json({ error: "Failed to fetch user" });
    }
});

app.get("/admin/users/edit/:id", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const editUser = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, firstName: true, lastName: true, name: true, email: true,
                badgeNumber: true, phoneNumber: true, role: true, isActive: true,
                institution: true, notifications: true, privacy: true, accessibility: true,
                integrations: true, twoFactorEnabled: true, loginAlerts: true,
                emergencyContact: true, shiftPreferences: true, timezone: true,
                dateFormat: true, timeFormat: true, theme: true
            }
        });
        if (!editUser) return res.status(404).render("error", { title: "Not Found", message: "User not found", error: {} });
        
        res.render("edit-user", { 
            title: "Edit User - Campus Guard Connect", 
            layout: false, 
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) }, 
            editUser, 
            notificationCount: res.locals.notificationCount || 0 
        });
    } catch (err) {
        console.error("❌ Edit user page error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading edit page", error: {} });
    }
});

app.put("/admin/users/:id", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { firstName, lastName, email, phoneNumber, role, badgeNumber, institution, isActive, shiftPreferences, emergencyContact } = req.body;
        const errors = [];
        const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
        
        if (!firstName?.trim()) errors.push({ msg: "First name is required", field: "firstName" });
        if (!lastName?.trim()) errors.push({ msg: "Last name is required", field: "lastName" });
        if (!email || !emailRegex.test(email)) errors.push({ msg: "Please enter a valid email", field: "email" });
        else { 
            const ex = await prisma.user.findFirst({ where: { email: email.toLowerCase(), NOT: { id: req.params.id } } });
            if (ex) errors.push({ msg: "Email already exists", field: "email" }); 
        }
        if ((role === "guard" || role === "supervisor") && badgeNumber) { 
            const ex = await prisma.user.findFirst({ where: { badgeNumber: badgeNumber.toUpperCase(), NOT: { id: req.params.id } } });
            if (ex) errors.push({ msg: "Badge number already exists", field: "badgeNumber" }); 
        }
        if (errors.length > 0) return res.status(400).json({ errors });
        
        const updateData = {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: `${firstName.trim()} ${lastName.trim()}`,
            email: email.toLowerCase().trim(),
            role,
            phoneNumber: phoneNumber || "",
            institution: institution || "",
            isActive: isActive === "true" || isActive === true,
            badgeNumber: (role === "guard" || role === "supervisor") && badgeNumber ? badgeNumber.toUpperCase().trim() : null
        };
        
        if (shiftPreferences) updateData.shiftPreferences = typeof shiftPreferences === "string" ? JSON.parse(shiftPreferences) : shiftPreferences;
        if (emergencyContact) updateData.emergencyContact = typeof emergencyContact === "string" ? JSON.parse(emergencyContact) : emergencyContact;
        
        const updated = await updateUser(req.params.id, updateData);
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "UPDATE_USER",
                category: "user",
                description: `Updated user: ${updated.name}`,
                targetId: updated.id,
                targetModel: "User",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "User updated successfully", user: updated });
    } catch (err) {
        console.error("❌ Update user error:", err);
        res.status(500).json({ success: false, message: "Failed to update user", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.delete("/admin/users/:id", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const user = await getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.id === req.session.userId) return res.status(400).json({ error: "You cannot delete your own account" });
        
        if (user.role === "guard") {
            const activePatrol = await getPatrols({ guard: user.id, status: "in_progress" });
            if (activePatrol.length > 0) return res.status(400).json({ error: "Cannot delete guard with active patrol" });
            
            const activeShift = await prisma.shift.findFirst({ where: { guard: user.id, status: "in_progress" } });
            if (activeShift) return res.status(400).json({ error: "Cannot delete guard with active shift" });
        }
        
        await updateUser(req.params.id, { isActive: false });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "DELETE_USER",
                category: "user",
                description: `Deactivated user: ${user.name}`,
                targetId: user.id,
                targetModel: "User",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "User deactivated successfully" });
    } catch (err) {
        console.error("❌ Delete user error:", err);
        res.status(500).json({ success: false, message: "Failed to delete user", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/admin/users/:id/reset-password", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { newPassword } = req.body;
        const user = await getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found" });
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        await updateUser(req.params.id, { password: hashedPassword, passwordLastChanged: new Date() });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "RESET_PASSWORD",
                category: "auth",
                description: `Reset password for user: ${user.name}`,
                targetId: user.id,
                targetModel: "User",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Password reset successfully", newPassword });
    } catch (err) {
        console.error("❌ Reset password error:", err);
        res.status(500).json({ success: false, message: "Failed to reset password", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.get("/admin/users/export", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { format } = req.query;
        const { Parser } = require("json2csv");
        const users = await prisma.user.findMany({
            select: {
                name: true, email: true, role: true, badgeNumber: true,
                phoneNumber: true, isActive: true, lastLogin: true, createdAt: true
            }
        });
        
        const exportData = users.map((u) => ({ 
            Name: u.name, Email: u.email, Role: u.role, BadgeNumber: u.badgeNumber || "N/A", 
            Phone: u.phoneNumber || "N/A", Status: u.isActive ? "Active" : "Inactive", 
            LastLogin: u.lastLogin ? new Date(u.lastLogin).toLocaleString() : "Never", 
            JoinedDate: u.createdAt ? new Date(u.createdAt).toLocaleString() : "" 
        }));
        
        const filename = `users-export-${new Date().toISOString().split("T")[0]}`;
        if (format === "csv") { 
            const csv = new Parser().parse(exportData); 
            res.setHeader("Content-Type", "text/csv"); 
            res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`); 
            return res.send(csv); 
        }
        if (format === "json") { 
            res.setHeader("Content-Type", "application/json"); 
            res.setHeader("Content-Disposition", `attachment; filename=${filename}.json`); 
            return res.json(exportData); 
        }
        return res.status(400).json({ error: "Invalid export format" });
    } catch (err) {
        console.error("❌ Export error:", err);
        res.status(500).json({ error: "Failed to export users" });
    }
});

app.post("/admin/users/bulk", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { action, userIds } = req.body;
        if (!userIds?.length) return res.status(400).json({ error: "No users selected" });
        
        let updateData = {};
        if (action === "activate") updateData = { isActive: true };
        else if (action === "deactivate") updateData = { isActive: false };
        else if (action === "delete") updateData = { isActive: false };
        else return res.status(400).json({ error: "Invalid action" });
        
        const result = await prisma.user.updateMany({
            where: { id: { in: userIds } },
            data: updateData
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: `BULK_${action.toUpperCase()}`,
                category: "user",
                description: `Bulk ${action} for ${userIds.length} users`,
                changes: { userIds, action },
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: `Bulk ${action} completed`, modifiedCount: result.count });
    } catch (err) {
        console.error("❌ Bulk operation error:", err);
        res.status(500).json({ error: "Failed to perform bulk operation" });
    }
});

app.get("/admin/users/:id/activity", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const activities = await getAuditLogs({ user: req.params.id });
        res.json(activities.slice(0, 50));
    } catch (err) {
        console.error("❌ Activity log error:", err);
        res.status(500).json({ error: "Failed to fetch activity log" });
    }
});

app.patch("/admin/users/:id/role", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { role } = req.body;
        const user = await getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.id === req.session.userId) return res.status(400).json({ error: "Cannot change your own role" });
        
        const oldRole = user.role;
        const updated = await updateUser(req.params.id, { role });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "CHANGE_ROLE",
                category: "user",
                description: `Changed user role from ${oldRole} to ${role}`,
                targetId: user.id,
                targetModel: "User",
                changes: { oldRole, newRole: role },
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Role updated successfully", user: { id: updated.id, name: updated.name, role: updated.role } });
    } catch (err) {
        console.error("❌ Role change error:", err);
        res.status(500).json({ error: "Failed to update role" });
    }
});

// ================== SYSTEM SETTINGS ==================

app.get("/settings/system", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const stats = {
            totalUsers: await countUsers(),
            totalGuards: await countUsers({ role: "guard" }),
            totalIncidents: await countIncidents(),
            totalPatrols: await countPatrols(),
            totalCheckpoints: await prisma.checkpoint.count(),
            totalShifts: await prisma.shift.count(),
            totalAttendance: await prisma.attendance.count(),
            databaseSize: await getDatabaseSize(),
            lastBackup: await getLastBackupTime(),
            uptime: process.uptime(),
            nodeVersion: process.version,
            environment: process.env.NODE_ENV || "development"
        };
        
        const config = {
            siteName: process.env.SITE_NAME || "Campus Guard Connect",
            siteUrl: process.env.SITE_URL || "http://localhost:3000",
            supportEmail: process.env.SUPPORT_EMAIL || "support@campusguard.com",
            maxLoginAttempts: process.env.MAX_LOGIN_ATTEMPTS || 5,
            sessionTimeout: process.env.SESSION_TIMEOUT || 24,
            passwordMinLength: process.env.PASSWORD_MIN_LENGTH || 8,
            twoFactorAuth: process.env.TWO_FACTOR_AUTH === "true",
            allowRegistration: process.env.ALLOW_REGISTRATION !== "false",
            requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
            defaultUserRole: process.env.DEFAULT_USER_ROLE || "student",
            timezone: process.env.TIMEZONE || "Africa/Nairobi",
            dateFormat: process.env.DATE_FORMAT || "MM/DD/YYYY",
            timeFormat: process.env.TIME_FORMAT || "24h"
        };
        
        const emailSettings = {
            host: process.env.EMAIL_HOST || "smtp.gmail.com",
            port: process.env.EMAIL_PORT || 587,
            secure: process.env.EMAIL_SECURE === "true",
            fromEmail: process.env.EMAIL_FROM || "noreply@campusguard.com",
            fromName: process.env.EMAIL_FROM_NAME || "Campus Guard Connect"
        };
        
        const securitySettings = {
            bcryptRounds: process.env.BCRYPT_ROUNDS || 10,
            sessionSecret: process.env.SESSION_SECRET ? "********" : "Not Set",
            jwtSecret: process.env.JWT_SECRET ? "********" : "Not Set",
            corsOrigins: process.env.CORS_ORIGINS || "*",
            rateLimit: process.env.RATE_LIMIT || 100,
            rateLimitWindow: process.env.RATE_LIMIT_WINDOW || 900000
        };
        
        const notificationSettings = {
            emailNotifications: process.env.EMAIL_NOTIFICATIONS !== "false",
            smsNotifications: process.env.SMS_NOTIFICATIONS === "true",
            pushNotifications: process.env.PUSH_NOTIFICATIONS === "true",
            incidentAlerts: process.env.INCIDENT_ALERTS !== "false",
            patrolAlerts: process.env.PATROL_ALERTS !== "false",
            shiftReminders: process.env.SHIFT_REMINDERS !== "false"
        };
        
        const recentLogs = await getAuditLogs({});
        const activeSessions = await getActiveSessionsCount();
        
        res.render("system-settings", {
            title: "System Settings - Campus Guard Connect",
            layout: false,
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) },
            notificationCount: res.locals.notificationCount || 0,
            stats,
            config,
            emailSettings,
            securitySettings,
            notificationSettings,
            recentLogs: recentLogs.slice(0, 50).map((log) => ({ ...log, time: formatRelativeTime(log.createdAt) })),
            activeSessions,
            currentTime: new Date().toISOString(),
            serverTime: new Date().toString()
        });
    } catch (err) {
        console.error("❌ System settings error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading system settings", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

app.post("/api/settings/general", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { siteName, siteUrl, supportEmail, maxLoginAttempts, sessionTimeout, passwordMinLength, twoFactorAuth, allowRegistration, requireEmailVerification, defaultUserRole, timezone, dateFormat, timeFormat } = req.body;
        const errors = [];
        
        if (!siteName?.trim()) errors.push({ msg: "Site name is required", field: "siteName" });
        if (siteUrl && !isValidUrl(siteUrl)) errors.push({ msg: "Invalid site URL", field: "siteUrl" });
        if (supportEmail && !isValidEmail(supportEmail)) errors.push({ msg: "Invalid support email", field: "supportEmail" });
        if (maxLoginAttempts && (maxLoginAttempts < 1 || maxLoginAttempts > 10)) errors.push({ msg: "Max login attempts must be between 1 and 10", field: "maxLoginAttempts" });
        if (sessionTimeout && (sessionTimeout < 1 || sessionTimeout > 720)) errors.push({ msg: "Session timeout must be between 1 and 720 hours", field: "sessionTimeout" });
        if (errors.length > 0) return res.status(400).json({ errors });
        
        const updates = {
            SITE_NAME: siteName,
            SITE_URL: siteUrl,
            SUPPORT_EMAIL: supportEmail,
            MAX_LOGIN_ATTEMPTS: maxLoginAttempts,
            SESSION_TIMEOUT: sessionTimeout,
            PASSWORD_MIN_LENGTH: passwordMinLength,
            TWO_FACTOR_AUTH: twoFactorAuth,
            ALLOW_REGISTRATION: allowRegistration,
            REQUIRE_EMAIL_VERIFICATION: requireEmailVerification,
            DEFAULT_USER_ROLE: defaultUserRole,
            TIMEZONE: timezone,
            DATE_FORMAT: dateFormat,
            TIME_FORMAT: timeFormat
        };
        
        Object.entries(updates).forEach(([k, v]) => { if (v !== undefined) process.env[k] = v.toString(); });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "UPDATE_GENERAL_SETTINGS",
                category: "system",
                description: "Updated general system settings",
                changes: updates,
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "General settings updated successfully" });
    } catch (err) {
        console.error("❌ Update general settings error:", err);
        res.status(500).json({ success: false, message: "Failed to update general settings", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/api/settings/email", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { emailHost, emailPort, emailSecure, emailUser, emailPassword, emailFrom, emailFromName } = req.body;
        const errors = [];
        
        if (!emailHost?.trim()) errors.push({ msg: "Email host is required", field: "emailHost" });
        if (!emailPort || isNaN(emailPort) || emailPort < 1 || emailPort > 65535) errors.push({ msg: "Valid email port is required (1-65535)", field: "emailPort" });
        if (emailFrom && !isValidEmail(emailFrom)) errors.push({ msg: "Invalid from email address", field: "emailFrom" });
        if (errors.length > 0) return res.status(400).json({ errors });
        
        if (emailPassword) process.env.EMAIL_PASSWORD = emailPassword;
        process.env.EMAIL_HOST = emailHost;
        process.env.EMAIL_PORT = emailPort;
        process.env.EMAIL_SECURE = emailSecure;
        process.env.EMAIL_FROM = emailFrom;
        process.env.EMAIL_FROM_NAME = emailFromName;
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "UPDATE_EMAIL_SETTINGS",
                category: "system",
                description: "Updated email configuration",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Email settings updated successfully" });
    } catch (err) {
        console.error("❌ Update email settings error:", err);
        res.status(500).json({ success: false, message: "Failed to update email settings", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/api/settings/security", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { bcryptRounds, sessionSecret, jwtSecret, corsOrigins, rateLimit, rateLimitWindow } = req.body;
        const errors = [];
        
        if (bcryptRounds && (bcryptRounds < 8 || bcryptRounds > 14)) errors.push({ msg: "bcrypt rounds must be between 8 and 14", field: "bcryptRounds" });
        if (sessionSecret && sessionSecret.length < 32) errors.push({ msg: "Session secret must be at least 32 characters", field: "sessionSecret" });
        if (jwtSecret && jwtSecret.length < 32) errors.push({ msg: "JWT secret must be at least 32 characters", field: "jwtSecret" });
        if (rateLimit && (rateLimit < 10 || rateLimit > 1000)) errors.push({ msg: "Rate limit must be between 10 and 1000", field: "rateLimit" });
        if (errors.length > 0) return res.status(400).json({ errors });
        
        if (sessionSecret) process.env.SESSION_SECRET = sessionSecret;
        if (jwtSecret) process.env.JWT_SECRET = jwtSecret;
        process.env.BCRYPT_ROUNDS = bcryptRounds;
        process.env.CORS_ORIGINS = corsOrigins;
        process.env.RATE_LIMIT = rateLimit;
        process.env.RATE_LIMIT_WINDOW = rateLimitWindow;
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "UPDATE_SECURITY_SETTINGS",
                category: "system",
                description: "Updated security settings",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Security settings updated successfully" });
    } catch (err) {
        console.error("❌ Update security settings error:", err);
        res.status(500).json({ success: false, message: "Failed to update security settings", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/api/settings/notifications", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { emailNotifications, smsNotifications, pushNotifications, incidentAlerts, patrolAlerts, shiftReminders } = req.body;
        const updates = {
            EMAIL_NOTIFICATIONS: emailNotifications,
            SMS_NOTIFICATIONS: smsNotifications,
            PUSH_NOTIFICATIONS: pushNotifications,
            INCIDENT_ALERTS: incidentAlerts,
            PATROL_ALERTS: patrolAlerts,
            SHIFT_REMINDERS: shiftReminders
        };
        Object.entries(updates).forEach(([k, v]) => { process.env[k] = v.toString(); });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "UPDATE_NOTIFICATION_SETTINGS",
                category: "system",
                description: "Updated notification settings",
                changes: updates,
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Notification settings updated successfully" });
    } catch (err) {
        console.error("❌ Update notification settings error:", err);
        res.status(500).json({ success: false, message: "Failed to update notification settings", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/api/system/backup", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const backupData = {
            timestamp: new Date(),
            users: await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } }),
            incidents: await prisma.incident.findMany(),
            patrols: await prisma.patrol.findMany(),
            shifts: await prisma.shift.findMany(),
            attendance: await prisma.attendance.findMany(),
            notifications: await prisma.notification.findMany(),
            checkpoints: await prisma.checkpoint.findMany(),
            auditLogs: await prisma.auditLog.findMany({ take: 1000 })
        };
        
        const backup = await createReport({
            title: `System Backup - ${new Date().toLocaleString()}`,
            type: "custom",
            generatedBy: req.session.userId,
            data: { recordCount: Object.keys(backupData).length },
            format: "json",
            status: "completed"
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "SYSTEM_BACKUP",
                category: "system",
                description: "Created system backup",
                targetId: backup.id,
                targetModel: "Report",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=backup-${new Date().toISOString().split("T")[0]}.json`);
        res.json(backupData);
    } catch (err) {
        console.error("❌ Backup error:", err);
        res.status(500).json({ success: false, message: "Failed to create backup", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/api/system/clear-cache", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "CLEAR_CACHE",
                category: "system",
                description: "Cleared system cache",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "System cache cleared successfully" });
    } catch (err) {
        console.error("❌ Clear cache error:", err);
        res.status(500).json({ success: false, message: "Failed to clear cache", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.get("/api/system/logs", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { level, from, to, limit = 100 } = req.query;
        const filter = {};
        if (level) filter.level = level;
        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.gte = new Date(from);
            if (to) filter.createdAt.lte = new Date(to);
        }
        
        const logs = await getAuditLogs(filter);
        res.json(logs.slice(0, parseInt(limit)));
    } catch (err) {
        console.error("❌ Get logs error:", err);
        res.status(500).json({ error: "Failed to fetch logs" });
    }
});

app.post("/api/settings/test-email", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { testEmail } = req.body;
        if (!testEmail || !isValidEmail(testEmail)) return res.status(400).json({ error: "Valid test email is required" });
        const result = await sendTestEmail(testEmail);
        result.success ? res.json({ success: true, message: `Test email sent to ${testEmail}` }) : res.status(500).json({ error: `Failed to send test email: ${result.error}` });
    } catch (err) {
        console.error("❌ Test email error:", err);
        res.status(500).json({ error: "Failed to send test email" });
    }
});

app.get("/api/system/health", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        res.json({
            status: "healthy",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            database: { status: "connected", collections: await getCollectionCounts() },
            api: { responseTime: await measureResponseTime(), requestsPerMinute: getRequestsPerMinute() }
        });
    } catch (err) {
        console.error("❌ Health check error:", err);
        res.status(500).json({ error: "Failed to check system health" });
    }
});


// ================== ROLES MANAGEMENT ROUTES ==================

// View all roles and permissions
app.get("/admin/roles", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        
        if (!user) {
            return res.redirect("/login");
        }
        
        // Get all users with their roles
        const users = await prisma.user.findMany({
            where: { isActive: true },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                name: true,
                email: true,
                role: true,
                badgeNumber: true,
                lastLogin: true,
                createdAt: true
            },
            orderBy: [
                { role: 'asc' },
                { name: 'asc' }
            ]
        });
        
        // Get role statistics
        const roleStats = {
            admin: users.filter(u => u.role === 'admin').length,
            supervisor: users.filter(u => u.role === 'supervisor').length,
            guard: users.filter(u => u.role === 'guard').length,
            student: users.filter(u => u.role === 'student').length,
            total: users.length
        };
        
        // Format users for template
        const formattedUsers = users.map(u => ({
            id: u.id,
            firstName: u.firstName,
            lastName: u.lastName,
            name: u.name,
            email: u.email,
            role: u.role,
            badgeNumber: u.badgeNumber || 'N/A',
            lastLogin: u.lastLogin,
            createdAt: u.createdAt,
            initials: getInitials(u.name || `${u.firstName} ${u.lastName}`),
            fullName: u.name || `${u.firstName} ${u.lastName}`
        }));
        
        res.render("roles", {
            title: "Role Management - Campus Guard Connect",
            layout: false,
            user: { 
                _id: user.id, 
                name: user.name, 
                role: user.role, 
                initials: getInitials(user.name),
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email
            },
            notificationCount: res.locals.notificationCount || 0,
            users: formattedUsers,
            roleStats: roleStats
        });
    } catch (err) {
        console.error("❌ Roles page error:", err);
        res.status(500).render("error", { 
            title: "Error", 
            message: "Error loading roles page: " + err.message, 
            error: process.env.NODE_ENV === "development" ? err : {} 
        });
    }
});

// Update user role (API endpoint)
app.put("/admin/roles/:userId", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { userId } = req.params;
        const { role } = req.body;
        
        // Validate role
        const validRoles = ["admin", "supervisor", "guard", "student"];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: "Invalid role" });
        }
        
        // Get the user to update
        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, email: true, role: true }
        });
        
        if (!targetUser) {
            return res.status(404).json({ error: "User not found" });
        }
        
        // Prevent admin from changing their own role
        if (userId === req.session.userId) {
            return res.status(400).json({ error: "You cannot change your own role" });
        }
        
        // Update the role
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { 
                role: role,
                updatedAt: new Date()
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                name: true,
                email: true,
                role: true
            }
        });
        
        // Create audit log
        await createAuditLog({
            user: req.session.userId,
            action: "UPDATE_ROLE",
            category: "user",
            description: `Changed user role from ${targetUser.role} to ${role} for ${targetUser.name || targetUser.email}`,
            targetId: userId,
            targetModel: "User",
            changes: { oldRole: targetUser.role, newRole: role },
            ipAddress: req.ip,
            userAgent: req.get("User-Agent") || "Unknown",
            status: "success"
        });
        
        // Send notification to the user
        await createNotification({
            recipient: userId,
            type: "info",
            title: "Role Updated",
            message: `Your role has been changed from ${targetUser.role} to ${role}`,
            priority: "medium"
        });
        
        res.json({ 
            success: true, 
            message: `Role updated to ${role} for ${updatedUser.name || updatedUser.email}`,
            user: updatedUser
        });
    } catch (err) {
        console.error("❌ Update role error:", err);
        res.status(500).json({ error: "Failed to update role: " + err.message });
    }
});

// Bulk update roles (API endpoint)
app.post("/admin/roles/bulk", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { userIds, role } = req.body;
        
        if (!userIds || !userIds.length) {
            return res.status(400).json({ error: "No users selected" });
        }
        
        const validRoles = ["admin", "supervisor", "guard", "student"];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: "Invalid role" });
        }
        
        // Filter out current admin
        const filteredIds = userIds.filter(id => id !== req.session.userId);
        
        if (!filteredIds.length) {
            return res.status(400).json({ error: "Cannot change your own role" });
        }
        
        // Get users before update for audit
        const users = await prisma.user.findMany({
            where: { id: { in: filteredIds } },
            select: { id: true, name: true, email: true, role: true }
        });
        
        // Update roles
        const result = await prisma.user.updateMany({
            where: { id: { in: filteredIds } },
            data: { 
                role: role,
                updatedAt: new Date()
            }
        });
        
        // Create audit log
        await createAuditLog({
            user: req.session.userId,
            action: "BULK_UPDATE_ROLES",
            category: "user",
            description: `Bulk updated ${result.count} users to role: ${role}`,
            changes: { userIds: filteredIds, newRole: role },
            ipAddress: req.ip,
            userAgent: req.get("User-Agent") || "Unknown",
            status: "success"
        });
        
        // Send notifications
        for (const user of users) {
            await createNotification({
                recipient: user.id,
                type: "info",
                title: "Role Updated",
                message: `Your role has been changed to ${role}`,
                priority: "medium"
            });
        }
        
        res.json({ 
            success: true, 
            message: `Updated ${result.count} users to ${role} role`,
            count: result.count
        });
    } catch (err) {
        console.error("❌ Bulk update roles error:", err);
        res.status(500).json({ error: "Failed to bulk update roles: " + err.message });
    }
});


// ================== AUDIT LOGS ==================

app.get("/admin/audit-logs", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const { category, status, userId, from, to, page = 1, limit = 25 } = req.query;
        const filter = {};
        if (category) filter.category = category;
        if (status) filter.status = status;
        if (userId) filter.user = userId;
        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.gte = new Date(from);
            if (to) filter.createdAt.lte = new Date(to);
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const totalLogs = await countAuditLogs(filter);
        const logs = await prisma.auditLog.findMany({
            where: filter,
            include: { userRecord: { select: { id: true, name: true, email: true, role: true } } },
            orderBy: { createdAt: 'desc' },
            skip,
            take: parseInt(limit)
        });
        
        const users = await prisma.user.findMany({
            select: { id: true, name: true, email: true },
            orderBy: { name: 'asc' }
        });
        
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
        
        const totalCount = await prisma.auditLog.count();
        const todayLogs = await prisma.auditLog.count({ where: { createdAt: { gte: today } } });
        const yesterdayLogs = await prisma.auditLog.count({ where: { createdAt: { gte: yesterday, lt: today } } });
        const successCount = await prisma.auditLog.count({ where: { status: "success" } });
        const failureCount = await prisma.auditLog.count({ where: { status: "failure" } });
        const uniqueUsers = await prisma.auditLog.groupBy({ by: ['user'], where: { createdAt: { gte: thirtyDaysAgo } } });
        
        const stats = {
            totalLogs: totalCount,
            todayLogs,
            yesterdayLogs,
            successCount,
            failureCount,
            successRate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0,
            failureRate: totalCount > 0 ? Math.round((failureCount / totalCount) * 100) : 0,
            uniqueUsers: uniqueUsers.length,
            todayIncrease: yesterdayLogs > 0 ? Math.round(((todayLogs - yesterdayLogs) / yesterdayLogs) * 100) : 0
        };
        
        const recentActivity = await prisma.auditLog.findMany({
            include: { userRecord: { select: { id: true, name: true, email: true, role: true } } },
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        
        const totalPages = Math.ceil(totalLogs / parseInt(limit));
        const pagination = {
            current: parseInt(page),
            total: totalPages,
            limit: parseInt(limit),
            prev: parseInt(page) > 1 ? parseInt(page) - 1 : null,
            next: parseInt(page) < totalPages ? parseInt(page) + 1 : null,
            pages: Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p;
                if (totalPages <= 5) p = i + 1;
                else if (parseInt(page) <= 3) p = i + 1;
                else if (parseInt(page) >= totalPages - 2) p = totalPages - 4 + i;
                else p = parseInt(page) - 2 + i;
                return { page: p, active: p === parseInt(page) };
            })
        };
        
        res.render("admin/audit-logs", {
            title: "Audit Logs - Campus Guard Connect",
            layout: false,
            user: { _id: user.id, name: user.name, role: user.role, initials: getInitials(user.name) },
            notificationCount: res.locals.notificationCount || 0,
            logs: logs.map((l) => ({ ...l, user: l.userRecord })),
            users,
            stats,
            recentActivity,
            pagination,
            filters: { category: category || "", status: status || "", userId: userId || "", from: from || "", to: to || "" }
        });
    } catch (err) {
        console.error("❌ Audit logs page error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading audit logs", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

app.get("/api/admin/audit-logs/recent-count", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const lastCheck = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 60000);
        const newLogs = await prisma.auditLog.count({ where: { createdAt: { gt: lastCheck } } });
        res.json({ newLogs });
    } catch (err) { res.status(500).json({ error: "Failed to fetch recent logs count" }); }
});

app.get("/api/admin/audit-logs/recent", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const logs = await prisma.auditLog.findMany({
            include: { userRecord: { select: { id: true, name: true, email: true, role: true } } },
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        res.json(logs);
    } catch (err) { res.status(500).json({ error: "Failed to fetch recent logs" }); }
});

app.get("/api/admin/audit-logs/export", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { format = "csv", ids, category, status, userId, from, to } = req.query;
        const { Parser } = require("json2csv");
        const filter = {};
        if (ids) { filter.id = { in: ids.split(",") }; }
        else {
            if (category) filter.category = category;
            if (status) filter.status = status;
            if (userId) filter.user = userId;
            if (from || to) {
                filter.createdAt = {};
                if (from) filter.createdAt.gte = new Date(from);
                if (to) filter.createdAt.lte = new Date(to);
            }
        }
        
        const logs = await prisma.auditLog.findMany({
            where: filter,
            include: { userRecord: { select: { name: true, email: true } } },
            orderBy: { createdAt: 'desc' }
        });
        
        const exportData = logs.map((l) => ({
            ID: l.id, Timestamp: new Date(l.createdAt).toLocaleString(),
            User: l.userRecord?.name || "System", UserEmail: l.userRecord?.email || "",
            Category: l.category, Action: l.action, Description: l.description || "",
            Status: l.status, "IP Address": l.ipAddress || "", "User Agent": l.userAgent || "",
            "Target Model": l.targetModel || "", "Target ID": l.targetId || "",
            Changes: l.changes ? JSON.stringify(l.changes) : ""
        }));
        
        const filename = `audit-logs-${new Date().toISOString().split("T")[0]}`;
        if (format === "csv") {
            const csv = new Parser().parse(exportData);
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`);
            return res.send(csv);
        }
        if (format === "json") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=${filename}.json`);
            return res.json(exportData);
        }
        return res.status(400).json({ error: "Invalid export format" });
    } catch (err) { res.status(500).json({ error: "Failed to export logs" }); }
});

app.post("/api/admin/audit-logs/bulk-delete", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids?.length) return res.status(400).json({ error: "No logs selected" });
        const result = await prisma.auditLog.deleteMany({ where: { id: { in: ids } } });
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "BULK_DELETE_LOGS",
                category: "system",
                description: `Deleted ${result.count} audit logs`,
                changes: { deletedIds: ids },
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        res.json({ success: true, message: `Successfully deleted ${result.count} logs`, deletedCount: result.count });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to delete logs", error: process.env.NODE_ENV === "development" ? err.message : {} }); }
});

app.post("/api/admin/audit-logs/clear", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { olderThan, category } = req.body;
        const filter = {};
        if (olderThan) filter.createdAt = { lt: new Date(olderThan) };
        if (category) filter.category = category;
        const result = await prisma.auditLog.deleteMany({ where: filter });
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "CLEAR_LOGS",
                category: "system",
                description: `Cleared ${result.count} logs`,
                changes: { olderThan, category, deletedCount: result.count },
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        res.json({ success: true, message: `Successfully cleared ${result.count} logs`, deletedCount: result.count });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to clear logs", error: process.env.NODE_ENV === "development" ? err.message : {} }); }
});

app.get("/api/admin/audit-logs/stats", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const startDate = new Date(Date.now() - parseInt(days) * 86400000);
        
        const categoryStats = await prisma.auditLog.groupBy({
            by: ['category'],
            where: { createdAt: { gte: startDate } },
            _count: { category: true },
            orderBy: { _count: { category: 'desc' } }
        });
        
        const statusStats = await prisma.auditLog.groupBy({
            by: ['status'],
            where: { createdAt: { gte: startDate } },
            _count: { status: true }
        });
        
        const dailyStatsRaw = await prisma.$queryRaw`
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM audit_logs
            WHERE created_at >= ${startDate}
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `;
        
        const topUsers = await prisma.auditLog.groupBy({
            by: ['user'],
            where: { createdAt: { gte: startDate }, user: { not: null } },
            _count: { user: true },
            orderBy: { _count: { user: 'desc' } },
            take: 10
        });
        
        const topUsersWithInfo = await Promise.all(topUsers.map(async (u) => {
            const userInfo = await prisma.user.findUnique({
                where: { id: u.user },
                select: { name: true, email: true }
            });
            return { _id: u.user, count: u._count.user, name: userInfo?.name, email: userInfo?.email };
        }));
        
        res.json({
            period: `${days} days`,
            categoryStats: categoryStats.map(c => ({ _id: c.category, count: c._count.category })),
            statusStats: statusStats.map(s => ({ _id: s.status, count: s._count.status })),
            dailyStats: dailyStatsRaw,
            topUsers: topUsersWithInfo
        });
    } catch (err) { res.status(500).json({ error: "Failed to fetch statistics" }); }
});

app.post("/api/admin/audit-logs/archive", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { olderThan } = req.body;
        if (!olderThan) return res.status(400).json({ error: "Please specify a date" });
        const archiveDate = new Date(olderThan);
        const logsToArchive = await prisma.auditLog.findMany({ where: { createdAt: { lt: archiveDate } } });
        if (!logsToArchive.length) return res.json({ message: "No logs to archive" });
        
        const archive = await createReport({
            title: `Audit Logs Archive - ${new Date().toLocaleDateString()}`,
            type: "custom",
            generatedBy: req.session.userId,
            data: {
                archivedDate: new Date(),
                olderThan: archiveDate,
                logCount: logsToArchive.length,
                logs: logsToArchive.map((l) => l.id)
            },
            format: "json",
            status: "completed"
        });
        
        await prisma.auditLog.deleteMany({ where: { createdAt: { lt: archiveDate } } });
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "ARCHIVE_LOGS",
                category: "system",
                description: `Archived ${logsToArchive.length} logs older than ${olderThan}`,
                changes: { archiveId: archive.id, count: logsToArchive.length },
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        res.json({ success: true, message: `Successfully archived ${logsToArchive.length} logs`, archiveId: archive.id });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to archive logs", error: process.env.NODE_ENV === "development" ? err.message : {} }); }
});

app.get("/api/admin/audit-logs/search", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { q, page = 1, limit = 25 } = req.query;
        if (!q || q.length < 2) return res.json({ logs: [], total: 0 });
        
        const logs = await prisma.auditLog.findMany({
            where: {
                OR: [
                    { action: { contains: q, mode: 'insensitive' } },
                    { description: { contains: q, mode: 'insensitive' } },
                    { category: { contains: q, mode: 'insensitive' } },
                    { ipAddress: { contains: q, mode: 'insensitive' } }
                ]
            },
            include: { userRecord: { select: { name: true, email: true } } },
            orderBy: { createdAt: 'desc' },
            skip: (parseInt(page) - 1) * parseInt(limit),
            take: parseInt(limit)
        });
        
        const total = await prisma.auditLog.count({
            where: {
                OR: [
                    { action: { contains: q, mode: 'insensitive' } },
                    { description: { contains: q, mode: 'insensitive' } },
                    { category: { contains: q, mode: 'insensitive' } },
                    { ipAddress: { contains: q, mode: 'insensitive' } }
                ]
            }
        });
        
        res.json({ logs, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
    } catch (err) { res.status(500).json({ error: "Failed to search logs" }); }
});

app.get("/api/admin/users/:userId/audit-logs", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { page = 1, limit = 25 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where: { user: req.params.userId },
                include: { userRecord: { select: { name: true, email: true } } },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.auditLog.count({ where: { user: req.params.userId } })
        ]);
        res.json({ logs, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
    } catch (err) { res.status(500).json({ error: "Failed to fetch user logs" }); }
});

app.get("/api/admin/audit-logs/target/:model/:id", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const { model, id } = req.params;
        const logs = await prisma.auditLog.findMany({
            where: { targetModel: model, targetId: id },
            include: { userRecord: { select: { name: true, email: true } } },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json(logs);
    } catch (err) { res.status(500).json({ error: "Failed to fetch target logs" }); }
});

app.get("/api/admin/audit-logs/:id", isAuthenticated, hasRole(["admin"]), async (req, res) => {
    try {
        const log = await prisma.auditLog.findUnique({
            where: { id: req.params.id },
            include: { userRecord: { select: { id: true, name: true, email: true, role: true } } }
        });
        if (!log) return res.status(404).json({ error: "Audit log not found" });
        if (log.changes && typeof log.changes === "string") { try { log.changes = JSON.parse(log.changes); } catch (_) {} }
        res.json(log);
    } catch (err) { res.status(500).json({ error: "Failed to fetch audit log" }); }
});



// ================== HELP & SUPPORT ==================

app.get("/help", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const helpArticles = {
            "getting-started": [
                { id: "account-creation", title: "Creating Your Account", description: "Learn how to create and set up your account, choose your role, and complete your profile.", readTime: 5, roles: ["admin","supervisor","guard","student"] },
                { id: "first-login", title: "First Time Login", description: "Step-by-step guide to logging in for the first time and navigating the dashboard.", readTime: 3, roles: ["admin","supervisor","guard","student"] },
                { id: "profile-settings", title: "Profile Settings", description: "How to update your profile, change password, and configure notification preferences.", readTime: 4, roles: ["admin","supervisor","guard","student"] },
            ],
            guards: [
                { id: "manage-shifts", title: "Managing Shifts", description: "Learn how to create, assign, and manage guard shifts efficiently.", readTime: 6, roles: ["admin","supervisor"] },
                { id: "attendance", title: "Attendance Tracking", description: "Using biometric and QR code check-in/out for accurate attendance monitoring.", readTime: 5, roles: ["admin","supervisor","guard"] },
                { id: "performance", title: "Performance Reviews", description: "How to evaluate guard performance and generate review reports.", readTime: 7, roles: ["admin","supervisor"] },
            ],
            incidents: [
                { id: "report-incident", title: "Reporting Incidents", description: "Step-by-step guide to reporting new incidents with photo evidence.", readTime: 4, roles: ["admin","supervisor","guard","student"] },
                { id: "incident-workflow", title: "Incident Workflow", description: "Understanding the incident lifecycle from report to resolution.", readTime: 8, roles: ["admin","supervisor","guard"] },
                { id: "incident-analytics", title: "Incident Analytics", description: "Analyzing incident patterns and generating reports for improvement.", readTime: 6, roles: ["admin"] },
            ],
            patrols: [
                { id: "start-patrol", title: "Starting a Patrol", description: "How to start, conduct, and complete patrol routes effectively.", readTime: 5, roles: ["guard"] },
                { id: "checkpoints", title: "Checkpoint Scanning", description: "Using QR codes and NFC for checkpoint verification during patrols.", readTime: 4, roles: ["guard"] },
                { id: "live-tracking", title: "Live Tracking", description: "Understanding the live tracking feature and map interface.", readTime: 5, roles: ["admin","supervisor","guard"] },
            ],
            reports: [
                { id: "generate-reports", title: "Generating Reports", description: "How to create and customize various report types.", readTime: 6, roles: ["admin","supervisor"] },
                { id: "metrics", title: "Understanding Metrics", description: "Interpreting KPIs and performance metrics in the dashboard.", readTime: 7, roles: ["admin","supervisor","guard"] },
                { id: "export-data", title: "Exporting Data", description: "Export reports in different formats (PDF, Excel, CSV).", readTime: 4, roles: ["admin"] },
            ],
        };
        const categoryCounts = { gettingStarted: helpArticles["getting-started"].length, guards: helpArticles.guards.length, incidents: helpArticles.incidents.length, patrols: helpArticles.patrols.length, reports: helpArticles.reports.length };
        const totalArticles = Object.values(helpArticles).reduce((acc, arr) => acc + arr.length, 0);
        const recentUpdates = [{ id: "incident-analytics", title: "Incident Analytics Dashboard" }, { id: "live-tracking", title: "Live Tracking Enhancements" }, { id: "performance", title: "New Performance Metrics" }, { id: "export-data", title: "Export to Excel Feature" }];
        
        res.render("help", {
            title: "Help & Support - Campus Guard Connect",
            layout: false,
            user: { _id: user.id, name: user.name, email: user.email, role: user.role, initials: getInitials(user.name) },
            notificationCount: res.locals.notificationCount || 0,
            helpArticles,
            categoryCounts,
            totalArticles,
            recentUpdates,
            userRole: user.role
        });
    } catch (err) {
        console.error("❌ Help page error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading help page", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

app.get("/api/help/categories", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const categories = [
            { id: "getting-started", name: "Getting Started", icon: "rocket", count: 3, allowedRoles: ["admin","supervisor","guard","student"] },
            { id: "guards", name: "Guard Management", icon: "user-shield", count: 3, allowedRoles: ["admin","supervisor"] },
            { id: "incidents", name: "Incident Handling", icon: "exclamation-triangle", count: 3, allowedRoles: ["admin","supervisor","guard"] },
            { id: "patrols", name: "Patrol Operations", icon: "route", count: 3, allowedRoles: ["guard"] },
            { id: "reports", name: "Reports & Analytics", icon: "chart-line", count: 3, allowedRoles: ["admin","supervisor"] }
        ];
        res.json(categories.filter((c) => c.allowedRoles.includes(user.role)));
    } catch (err) { res.status(500).json({ error: "Failed to fetch categories" }); }
});

app.get("/api/help/search", isAuthenticated, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        const results = [
            { id: "account-creation", title: "Creating Your Account", category: "getting-started", description: "Learn how to create and set up your account" },
            { id: "report-incident", title: "Reporting Incidents", category: "incidents", description: "Step-by-step guide to reporting new incidents" },
            { id: "start-patrol", title: "Starting a Patrol", category: "patrols", description: "How to start, conduct, and complete patrol routes" }
        ].filter((a) => a.title.toLowerCase().includes(q.toLowerCase()) || a.description.toLowerCase().includes(q.toLowerCase()));
        res.json(results);
    } catch (err) { res.status(500).json({ error: "Failed to search articles" }); }
});

app.post("/api/feedback", isAuthenticated, async (req, res) => {
    try {
        const { rating, category, message } = req.body;
        if (!message?.trim()) return res.status(400).json({ error: "Message is required" });
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "SUBMIT_FEEDBACK",
                category: "system",
                description: `Submitted feedback with rating ${rating}`,
                changes: { rating, category },
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        res.json({ success: true, message: "Thank you for your feedback!" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to submit feedback", error: process.env.NODE_ENV === "development" ? err.message : {} }); }
});

// ================== SUPPORT ==================

app.get("/support", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const userTickets = await getSupportTickets({ createdBy: user.id });
        let allTickets = [];
        if (["admin","supervisor"].includes(user.role)) {
            allTickets = await getSupportTickets({});
        }
        let unassignedTickets = [];
        if (["admin","supervisor"].includes(user.role)) {
            unassignedTickets = await getSupportTickets({ assignedTo: null, status: { not: "closed" } });
        }
        
        const stats = {
            openTickets: await prisma.supportTicket.count({ where: { status: { in: ["open","in-progress"] } } }) || 0,
            resolvedToday: await prisma.supportTicket.count({ where: { status: "resolved", updatedAt: { gte: new Date().setHours(0,0,0,0) } } }) || 0,
            avgResponseTime: 2.5,
            satisfaction: 98,
            newToday: await prisma.supportTicket.count({ where: { createdAt: { gte: new Date().setHours(0,0,0,0) } } }) || 0,
            resolutionRate: 95,
            responseTrend: "-5%",
            reviews: 128
        };
        
        const base = ["admin","supervisor"].includes(user.role) ? allTickets : userTickets;
        const tickets = base.map((t) => ({
            id: t.id.slice(-6).toUpperCase(),
            subject: t.subject,
            description: t.description.substring(0, 60) + "...",
            category: t.category,
            priority: t.priority,
            status: t.status,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt
        }));
        
        res.render("support", {
            title: "Support Center - Campus Guard Connect",
            layout: false,
            user: { _id: user.id, name: user.name, email: user.email, role: user.role, initials: getInitials(user.name) },
            notificationCount: res.locals.notificationCount || 0,
            stats,
            tickets,
            ticketCounts: { myTickets: userTickets.length, allTickets: allTickets.length, unassigned: unassignedTickets.length }
        });
    } catch (err) {
        console.error("❌ Support page error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading support page", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

app.post("/api/support/tickets", isAuthenticated, async (req, res) => {
    try {
        const { subject, category, priority, relatedTo, description } = req.body;
        const errors = [];
        if (!subject?.trim()) errors.push({ msg: "Subject is required", field: "subject" });
        if (!category) errors.push({ msg: "Category is required", field: "category" });
        if (!priority) errors.push({ msg: "Priority is required", field: "priority" });
        if (!description?.trim()) errors.push({ msg: "Description is required", field: "description" });
        if (errors.length > 0) return res.status(400).json({ errors });
        
        const ticketData = {
            ticketId: `TKT-${Date.now().toString(36).toUpperCase()}`,
            subject,
            category,
            priority,
            description,
            status: "open",
            createdBy: req.session.userId,
            messages: [{ user: req.session.userId, text: description, createdAt: new Date() }]
        };
        if (relatedTo) ticketData.relatedTo = relatedTo;
        
        const ticket = await createSupportTicket(ticketData);
        
        try {
            const admins = await prisma.user.findMany({ where: { role: "admin" } });
            for (const a of admins) {
                await createNotification({
                    recipient: a.id,
                    type: "info",
                    title: "New Support Ticket",
                    message: `New ticket created: ${subject}`,
                    relatedTo: { model: "SupportTicket", id: ticket.id },
                    priority: priority === "urgent" ? "urgent" : "medium"
                });
            }
        } catch (_) {}
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "CREATE_TICKET",
                category: "support",
                description: `Created support ticket: ${subject}`,
                targetId: ticket.id,
                targetModel: "SupportTicket",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.status(201).json({ success: true, message: "Ticket created successfully", ticket: { id: ticket.id, ticketId: ticket.ticketId, subject: ticket.subject } });
    } catch (err) {
        console.error("❌ Create ticket error:", err);
        res.status(500).json({ success: false, message: "Failed to create ticket", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.get("/api/support/tickets/recent", isAuthenticated, async (req, res) => {
    try {
        const newTickets = await prisma.supportTicket.count({ where: { createdAt: { gt: new Date(Date.now() - 300000) } } });
        res.json({ newTickets });
    } catch (err) { res.status(500).json({ error: "Failed to fetch recent tickets" }); }
});

app.get("/api/support/user/tickets", isAuthenticated, async (req, res) => {
    try {
        const tickets = await getSupportTickets({ createdBy: req.session.userId });
        res.json(tickets.map((t) => ({
            id: t.id,
            ticketId: t.ticketId,
            subject: t.subject,
            category: t.category,
            priority: t.priority,
            status: t.status,
            createdAt: t.createdAt,
            lastUpdated: t.updatedAt
        })));
    } catch (err) { res.status(500).json({ error: "Failed to fetch user tickets" }); }
});

app.get("/api/support/tickets/:id", isAuthenticated, async (req, res) => {
    try {
        const ticket = await prisma.supportTicket.findUnique({
            where: { id: req.params.id },
            include: {
                creator: { select: { id: true, name: true, email: true } },
                assignee: { select: { id: true, name: true, email: true } }
            }
        });
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });
        if (ticket.creator.id !== req.session.userId && !["admin","supervisor"].includes(req.session.userRole)) {
            return res.status(403).json({ error: "Access denied" });
        }
        
        const messages = ticket.messages || [];
        const enhancedMessages = messages.map((m) => ({
            ...m,
            user: { ...m.user, initials: getInitials(m.user.name) }
        }));
        
        res.json({ ...ticket, messages: enhancedMessages });
    } catch (err) { res.status(500).json({ error: "Failed to fetch ticket" }); }
});

app.post("/api/support/tickets/:id/reply", isAuthenticated, async (req, res) => {
    try {
        const { message } = req.body;
        const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });
        if (ticket.createdBy !== req.session.userId && !["admin","supervisor"].includes(req.session.userRole)) {
            return res.status(403).json({ error: "Access denied" });
        }
        if (!message?.trim()) return res.status(400).json({ error: "Message is required" });
        
        const messages = ticket.messages || [];
        messages.push({ user: req.session.userId, text: message, createdAt: new Date() });
        
        let newStatus = ticket.status;
        if (ticket.status === "closed") newStatus = "open";
        else if (ticket.status === "resolved") newStatus = "in-progress";
        
        await prisma.supportTicket.update({
            where: { id: req.params.id },
            data: { messages, status: newStatus, updatedAt: new Date() }
        });
        
        const notifyUser = ticket.createdBy === req.session.userId ? ticket.assignedTo : ticket.createdBy;
        if (notifyUser) {
            try {
                await createNotification({
                    recipient: notifyUser,
                    type: "info",
                    title: "New Ticket Reply",
                    message: `New reply on ticket: ${ticket.subject}`,
                    relatedTo: { model: "SupportTicket", id: ticket.id }
                });
            } catch (_) {}
        }
        
        res.json({ success: true, message: "Reply sent successfully" });
    } catch (err) { res.status(500).json({ error: "Failed to send reply" }); }
});

app.patch("/api/support/tickets/:id/status", isAuthenticated, async (req, res) => {
    try {
        const { status } = req.body;
        const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });
        if (!["admin","supervisor"].includes(req.session.userRole)) return res.status(403).json({ error: "Access denied" });
        
        const oldStatus = ticket.status;
        await prisma.supportTicket.update({
            where: { id: req.params.id },
            data: { status, updatedAt: new Date() }
        });
        
        try {
            await createNotification({
                recipient: ticket.createdBy,
                type: "info",
                title: "Ticket Status Updated",
                message: `Your ticket status changed from ${oldStatus} to ${status}`,
                relatedTo: { model: "SupportTicket", id: ticket.id }
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Ticket status updated" });
    } catch (err) { res.status(500).json({ error: "Failed to update status" }); }
});

app.post("/api/support/tickets/:id/resolve", isAuthenticated, async (req, res) => {
    try {
        const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });
        if (!["admin","supervisor"].includes(req.session.userRole)) return res.status(403).json({ error: "Access denied" });
        
        await prisma.supportTicket.update({
            where: { id: req.params.id },
            data: { status: "resolved", resolvedAt: new Date(), updatedAt: new Date() }
        });
        
        try {
            await createNotification({
                recipient: ticket.createdBy,
                type: "success",
                title: "Ticket Resolved",
                message: `Your ticket has been resolved: ${ticket.subject}`,
                relatedTo: { model: "SupportTicket", id: ticket.id }
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Ticket resolved successfully" });
    } catch (err) { res.status(500).json({ error: "Failed to resolve ticket" }); }
});

app.post("/api/support/tickets/:id/close", isAuthenticated, async (req, res) => {
    try {
        const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });
        if (ticket.createdBy !== req.session.userId && !["admin","supervisor"].includes(req.session.userRole)) {
            return res.status(403).json({ error: "Access denied" });
        }
        
        await prisma.supportTicket.update({
            where: { id: req.params.id },
            data: { status: "closed", updatedAt: new Date() }
        });
        
        const notifications = [];
        if (ticket.assignedTo) {
            notifications.push({
                recipient: ticket.assignedTo,
                type: "info",
                title: "Ticket Closed",
                message: `Ticket has been closed: ${ticket.subject}`,
                relatedTo: { model: "SupportTicket", id: ticket.id }
            });
        }
        notifications.push({
            recipient: ticket.createdBy,
            type: "info",
            title: "Ticket Closed",
            message: `Your ticket has been closed: ${ticket.subject}`,
            relatedTo: { model: "SupportTicket", id: ticket.id }
        });
        
        try { await prisma.notification.createMany({ data: notifications }); } catch (_) {}
        res.json({ success: true, message: "Ticket closed successfully" });
    } catch (err) { res.status(500).json({ error: "Failed to close ticket" }); }
});

app.post("/api/support/tickets/:id/assign", isAuthenticated, async (req, res) => {
    try {
        const { assignTo } = req.body;
        const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });
        if (!["admin","supervisor"].includes(req.session.userRole)) return res.status(403).json({ error: "Access denied" });
        
        const assignedUser = await getUserById(assignTo);
        if (!assignedUser) return res.status(404).json({ error: "User not found" });
        
        await prisma.supportTicket.update({
            where: { id: req.params.id },
            data: { assignedTo: assignTo, updatedAt: new Date() }
        });
        
        try {
            await createNotification({
                recipient: assignTo,
                type: "info",
                title: "Ticket Assigned",
                message: `You have been assigned to ticket: ${ticket.subject}`,
                relatedTo: { model: "SupportTicket", id: ticket.id }
            });
        } catch (_) {}
        
        res.json({ success: true, message: `Ticket assigned to ${assignedUser.name}` });
    } catch (err) { res.status(500).json({ error: "Failed to assign ticket" }); }
});

app.post("/api/support/upload", isAuthenticated, upload.array("attachments", 5), async (req, res) => {
    try {
        if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });
        res.json({ success: true, files: req.files.map((f) => ({ filename: f.originalname, path: f.path, size: f.size, mimetype: f.mimetype })) });
    } catch (err) { res.status(500).json({ error: "Failed to upload files" }); }
});

// ================== PROFILE ==================

app.get("/profile", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        if (!user) { req.session.destroy(); return res.redirect("/login"); }
        
        let stats = { patrols: 0, incidents: 0 };
        if (user.role === "guard") {
            stats.patrols = await countPatrols({ guard: user.id }) || 0;
            stats.incidents = await countIncidents({ $or: [{ reportedBy: user.id }, { assignedTo: { has: user.id } }] }) || 0;
        } else if (user.role === "supervisor") {
            stats.patrols = await countPatrols({ supervisor: user.id }) || 0;
            stats.incidents = await countIncidents({ assignedTo: { has: user.id } }) || 0;
        } else if (user.role === "student") {
            stats.incidents = await countIncidents({ reportedBy: user.id }) || 0;
        }
        
        const recentActivity = await getAuditLogs({ user: user.id });
        const activeSessions = await getActiveSessionsCount(user.id);
        const devices = await getConnectedDevices(user.id, req.sessionID);
        
        const enhancedUser = {
            ...user,
            initials: getInitials(user.name || `${user.firstName} ${user.lastName}`),
            notifications: user.notifications || { email: true, push: true, sms: false, incidents: true, shifts: true, patrols: true },
            twoFactorEnabled: user.twoFactorEnabled || false,
            loginAlerts: user.loginAlerts !== false
        };
        
        res.render("profile", {
            title: "My Profile - Campus Guard Connect",
            layout: false,
            user: {
                _id: enhancedUser.id,
                name: enhancedUser.name,
                firstName: enhancedUser.firstName,
                lastName: enhancedUser.lastName,
                email: enhancedUser.email,
                role: enhancedUser.role,
                phoneNumber: enhancedUser.phoneNumber || "Not provided",
                institution: enhancedUser.institution || "Not provided",
                badgeNumber: enhancedUser.badgeNumber,
                profileImage: enhancedUser.profileImage,
                initials: enhancedUser.initials,
                createdAt: enhancedUser.createdAt,
                lastLogin: enhancedUser.lastLogin,
                timezone: enhancedUser.timezone || "Africa/Nairobi",
                emergencyContact: enhancedUser.emergencyContact || { name: "", relationship: "", phone: "" },
                shiftPreferences: enhancedUser.shiftPreferences || { preferredShifts: [], maxHoursPerWeek: 40 },
                notifications: enhancedUser.notifications,
                twoFactorEnabled: enhancedUser.twoFactorEnabled,
                loginAlerts: enhancedUser.loginAlerts,
                passwordLastChanged: enhancedUser.passwordLastChanged
            },
            profileUser: enhancedUser,
            stats,
            recentActivity: recentActivity.slice(0, 10).map((a) => ({ timestamp: a.createdAt, action: a.action, description: a.description })),
            activeSessions,
            devices,
            notificationCount: res.locals.notificationCount || 0
        });
    } catch (err) {
        console.error("❌ Profile page error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading profile", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

app.post("/api/profile/update", isAuthenticated, async (req, res) => {
    try {
        const { firstName, lastName, phoneNumber, institution, timezone, emergencyContact, shiftPreferences } = req.body;
        const errors = [];
        
        if (!firstName?.trim()) errors.push({ msg: "First name is required", field: "firstName" });
        if (!lastName?.trim()) errors.push({ msg: "Last name is required", field: "lastName" });
        if (phoneNumber && !isValidPhone(phoneNumber)) errors.push({ msg: "Please enter a valid phone number", field: "phoneNumber" });
        if (errors.length > 0) return res.status(400).json({ errors });
        
        const updateData = {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: `${firstName.trim()} ${lastName.trim()}`,
            phoneNumber: phoneNumber || "",
            institution: institution || "",
            timezone: timezone || "Africa/Nairobi"
        };
        if (emergencyContact) updateData.emergencyContact = emergencyContact;
        if (shiftPreferences) updateData.shiftPreferences = shiftPreferences;
        
        const updated = await updateUser(req.session.userId, updateData);
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "UPDATE_PROFILE",
                category: "user",
                description: "Updated profile information",
                targetId: req.session.userId,
                targetModel: "User",
                changes: updateData,
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Profile updated successfully", user: updated });
    } catch (err) {
        console.error("❌ Profile update error:", err);
        res.status(500).json({ success: false, message: "Failed to update profile", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/api/profile/avatar", isAuthenticated, uploadAvatar.single("avatar"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const allowedTypes = ["image/jpeg","image/png","image/gif","image/webp"];
        if (!allowedTypes.includes(req.file.mimetype)) return res.status(400).json({ error: "Invalid file type." });
        if (req.file.size > 5 * 1024 * 1024) return res.status(400).json({ error: "File too large. Maximum size is 5MB." });
        
        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        await updateUser(req.session.userId, { profileImage: avatarUrl });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "UPDATE_AVATAR",
                category: "user",
                description: "Updated profile picture",
                targetId: req.session.userId,
                targetModel: "User",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Avatar updated successfully", avatarUrl });
    } catch (err) {
        console.error("❌ Avatar upload error:", err);
        res.status(500).json({ success: false, message: "Failed to upload avatar", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/api/profile/password", isAuthenticated, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        const errors = [];
        
        if (!currentPassword) errors.push({ msg: "Current password is required", field: "currentPassword" });
        if (!newPassword || newPassword.length < 8) errors.push({ msg: "Password must be at least 8 characters", field: "newPassword" });
        else if (!/(?=.*\d)(?=.*[!@#$%^&*])/.test(newPassword)) errors.push({ msg: "Password must contain at least one number and one special character", field: "newPassword" });
        if (newPassword !== confirmPassword) errors.push({ msg: "Passwords do not match", field: "confirmPassword" });
        if (errors.length > 0) return res.status(400).json({ errors });
        
        const user = await getUserById(req.session.userId);
        if (!user) return res.status(404).json({ error: "User not found" });
        
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(400).json({ errors: [{ msg: "Current password is incorrect", field: "currentPassword" }] });
        if (currentPassword === newPassword) return res.status(400).json({ errors: [{ msg: "New password must be different from current password", field: "newPassword" }] });
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        await updateUser(req.session.userId, { password: hashedPassword, passwordLastChanged: new Date() });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "CHANGE_PASSWORD",
                category: "auth",
                description: "Changed password",
                targetId: req.session.userId,
                targetModel: "User",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        await invalidateOtherSessions(req.session.userId, req.sessionID);
        res.json({ success: true, message: "Password changed successfully" });
    } catch (err) {
        console.error("❌ Password change error:", err);
        res.status(500).json({ success: false, message: "Failed to change password", error: process.env.NODE_ENV === "development" ? err.message : {} });
    }
});

app.post("/api/profile/logout-all", isAuthenticated, async (req, res) => {
    try {
        await invalidateOtherSessions(req.session.userId, req.sessionID);
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "LOGOUT_ALL_DEVICES",
                category: "auth",
                description: "Logged out from all other devices",
                targetId: req.session.userId,
                targetModel: "User",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        res.json({ success: true, message: "Logged out from all other devices" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to logout all devices", error: process.env.NODE_ENV === "development" ? err.message : {} }); }
});

app.post("/api/profile/devices/:sessionId/logout", isAuthenticated, async (req, res) => {
    try {
        await prisma.session.deleteMany({ where: { sid: req.params.sessionId } });
        res.json({ success: true, message: "Device logged out successfully" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to logout device", error: process.env.NODE_ENV === "development" ? err.message : {} }); }
});

app.get("/api/profile/activity", isAuthenticated, async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const activities = await getAuditLogs({ user: req.session.userId });
        res.json(activities.slice(0, parseInt(limit)).map((a) => ({
            id: a.id,
            action: a.action,
            description: a.description,
            category: a.category,
            timestamp: a.createdAt,
            ipAddress: a.ipAddress,
            userAgent: a.userAgent
        })));
    } catch (err) { res.status(500).json({ error: "Failed to fetch activity" }); }
});

app.get("/api/profile/devices", isAuthenticated, async (req, res) => {
    try {
        const devices = await getConnectedDevices(req.session.userId, req.sessionID);
        res.json(devices);
    } catch (err) { res.status(500).json({ error: "Failed to fetch devices" }); }
});

const profileToggle = (field, category) => async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        if (!user) return res.status(404).json({ error: "User not found" });
        if (category) {
            const obj = user[category] || {};
            obj[field] = !obj[field];
            await updateUser(req.session.userId, { [category]: obj });
        } else {
            await updateUser(req.session.userId, { [field]: !user[field] });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: `Failed to toggle ${field}` }); }
};

app.post("/api/profile/2fa/toggle", isAuthenticated, profileToggle("twoFactorEnabled", null));
app.post("/api/profile/settings/loginAlerts/toggle", isAuthenticated, profileToggle("loginAlerts", null));
app.post("/api/profile/notifications/:type/toggle", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const notifications = user.notifications || {};
        notifications[req.params.type] = !notifications[req.params.type];
        await updateUser(req.session.userId, { notifications });
        res.json({ success: true, enabled: notifications[req.params.type] });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to toggle notification" }); }
});

app.post("/api/profile/alerts/:type/toggle", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const notifications = user.notifications || {};
        notifications[req.params.type] = !notifications[req.params.type];
        await updateUser(req.session.userId, { notifications });
        res.json({ success: true, enabled: notifications[req.params.type] });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to toggle alert" }); }
});

// ================== SETTINGS PAGE ==================

app.get("/settings", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        if (!user) { req.session.destroy(); return res.redirect("/login"); }
        
        const activeSessions = await getActiveSessionsCount(user.id);
        const apiKeys = await getApiKeys(user.id);
        const webhooks = await getWebhooks(user.id);
        const backups = await getBackups(user.id);
        
        const integrations = {
            slack: user.integrations?.slack || false,
            telegram: user.integrations?.telegram || false,
            outlook: user.integrations?.outlook || false,
            google: user.integrations?.google || false
        };
        
        const enhancedUser = {
            ...user,
            initials: getInitials(user.name || `${user.firstName} ${user.lastName}`),
            notifications: user.notifications || {
                email: true, push: true, sms: false,
                newIncidents: true, incidentUpdates: true, criticalIncidents: true,
                patrolStart: true, patrolComplete: true, missedCheckpoints: true,
                upcomingShifts: true, shiftChanges: true
            },
            privacy: user.privacy || { profileVisibility: "team", locationTracking: true, activityHistory: true, dataSharing: false, marketingEmails: false },
            accessibility: user.accessibility || { screenReader: false, highContrast: false, largeText: false, fontSize: "medium" },
            timezone: user.timezone || "Africa/Nairobi",
            dateFormat: user.dateFormat || "MM/DD/YYYY",
            timeFormat: user.timeFormat || "12h",
            firstDayOfWeek: user.firstDayOfWeek || "sunday",
            theme: user.theme || "system",
            compactMode: user.compactMode || false,
            reduceAnimations: user.reduceAnimations || false,
            language: user.language || "en",
            country: user.country || "KE",
            currency: user.currency || "KES",
            measurement: user.measurement || "metric",
            sessionTimeout: user.sessionTimeout || 30,
            twoFactorEnabled: user.twoFactorEnabled || false,
            loginAlerts: user.loginAlerts !== false
        };
        
        res.render("settings", {
            title: "Settings - Campus Guard Connect",
            layout: false,
            user: {
                _id: enhancedUser.id,
                name: enhancedUser.name,
                firstName: enhancedUser.firstName,
                lastName: enhancedUser.lastName,
                email: enhancedUser.email,
                role: enhancedUser.role,
                initials: enhancedUser.initials,
                timezone: enhancedUser.timezone,
                dateFormat: enhancedUser.dateFormat,
                timeFormat: enhancedUser.timeFormat,
                firstDayOfWeek: enhancedUser.firstDayOfWeek,
                theme: enhancedUser.theme,
                compactMode: enhancedUser.compactMode,
                reduceAnimations: enhancedUser.reduceAnimations,
                language: enhancedUser.language,
                country: enhancedUser.country,
                currency: enhancedUser.currency,
                measurement: enhancedUser.measurement,
                sessionTimeout: enhancedUser.sessionTimeout,
                twoFactorEnabled: enhancedUser.twoFactorEnabled,
                loginAlerts: enhancedUser.loginAlerts,
                passwordLastChanged: enhancedUser.passwordLastChanged,
                notifications: enhancedUser.notifications,
                privacy: enhancedUser.privacy,
                accessibility: enhancedUser.accessibility
            },
            activeSessions,
            apiKeys: apiKeys.map((k) => ({ id: k.id, name: k.name, key: maskApiKey(k.key), createdAt: k.createdAt, lastUsed: k.lastUsed })),
            webhooks: webhooks.map((w) => ({ id: w.id, url: w.url, events: w.events.join(", "), createdAt: w.createdAt })),
            backups: backups.map((b) => ({ id: b.id, name: b.name, size: formatFileSize(b.size), createdAt: b.createdAt })),
            integrations,
            notificationCount: res.locals.notificationCount || 0
        });
    } catch (err) {
        console.error("❌ Settings page error:", err);
        res.status(500).render("error", { title: "Error", message: "Error loading settings page", error: process.env.NODE_ENV === "development" ? err : {} });
    }
});

app.post("/api/settings/update", isAuthenticated, async (req, res) => {
    try {
        const { displayName, timezone, dateFormat, timeFormat, firstDayOfWeek, sessionTimeout, profileVisibility, country, currency, measurement, fontSize } = req.body;
        const nameParts = displayName?.split(" ") || [];
        const updateData = {
            firstName: nameParts[0] || "",
            lastName: nameParts.slice(1).join(" ") || "",
            name: displayName,
            timezone,
            dateFormat,
            timeFormat,
            firstDayOfWeek,
            sessionTimeout: parseInt(sessionTimeout),
            country,
            currency,
            measurement
        };
        if (profileVisibility) updateData.privacy = { profileVisibility };
        if (fontSize) updateData.accessibility = { fontSize };
        
        await updateUser(req.session.userId, updateData);
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "UPDATE_SETTINGS",
                category: "user",
                description: "Updated account settings",
                changes: updateData,
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Settings updated successfully" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to update settings", error: process.env.NODE_ENV === "development" ? err.message : {} }); }
});

app.post("/api/settings/theme", isAuthenticated, async (req, res) => {
    try { await updateUser(req.session.userId, { theme: req.body.theme }); res.json({ success: true }); }
    catch (_) { res.status(500).json({ success: false }); }
});

app.post("/api/settings/language", isAuthenticated, async (req, res) => {
    try { await updateUser(req.session.userId, { language: req.body.language }); res.json({ success: true }); }
    catch (_) { res.status(500).json({ success: false }); }
});

app.post("/api/settings/2fa/toggle", isAuthenticated, profileToggle("twoFactorEnabled", null));
app.post("/api/settings/login-alerts/toggle", isAuthenticated, profileToggle("loginAlerts", null));
app.post("/api/settings/compact-mode/toggle", isAuthenticated, profileToggle("compactMode", null));
app.post("/api/settings/reduce-animations/toggle", isAuthenticated, profileToggle("reduceAnimations", null));

app.post("/api/settings/notifications/:type/toggle", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const notifications = user.notifications || {};
        notifications[req.params.type] = !notifications[req.params.type];
        await updateUser(req.session.userId, { notifications });
        res.json({ success: true });
    } catch (_) { res.status(500).json({ success: false }); }
});

app.post("/api/settings/alerts/:type/toggle", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const notifications = user.notifications || {};
        notifications[req.params.type] = !notifications[req.params.type];
        await updateUser(req.session.userId, { notifications });
        res.json({ success: true });
    } catch (_) { res.status(500).json({ success: false }); }
});

app.post("/api/settings/privacy/:setting/toggle", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const privacy = user.privacy || {};
        privacy[req.params.setting] = !privacy[req.params.setting];
        await updateUser(req.session.userId, { privacy });
        res.json({ success: true });
    } catch (_) { res.status(500).json({ success: false }); }
});

app.post("/api/settings/accessibility/:feature/toggle", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const accessibility = user.accessibility || {};
        accessibility[req.params.feature] = !accessibility[req.params.feature];
        await updateUser(req.session.userId, { accessibility });
        res.json({ success: true });
    } catch (_) { res.status(500).json({ success: false }); }
});

app.post("/api/settings/integrations/:integration/toggle", isAuthenticated, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        const integrations = user.integrations || {};
        integrations[req.params.integration] = !integrations[req.params.integration];
        await updateUser(req.session.userId, { integrations });
        res.json({ success: true });
    } catch (_) { res.status(500).json({ success: false }); }
});

app.post("/api/settings/api-keys", isAuthenticated, async (req, res) => {
    try {
        const { name, permissions, expiration } = req.body;
        if (!name) return res.status(400).json({ error: "Key name is required" });
        
        const key = generateApiKey();
        let expiresAt = null;
        if (expiration !== "never") {
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + parseInt(expiration));
        }
        
        const apiKey = await createApiKey({
            user: req.session.userId,
            name,
            key: hashApiKey(key),
            permissions: permissions || ["read"],
            expiresAt
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "CREATE_API_KEY",
                category: "user",
                description: `Created API key: ${name}`,
                targetId: apiKey.id,
                targetModel: "ApiKey",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, key, message: "API key generated successfully" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to generate API key" }); }
});

app.delete("/api/settings/api-keys/:id", isAuthenticated, async (req, res) => {
    try {
        const result = await deleteApiKey(req.params.id, req.session.userId);
        if (result.count === 0) return res.status(404).json({ error: "API key not found" });
        
        res.json({ success: true, message: "API key revoked" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to revoke API key" }); }
});

app.post("/api/settings/webhooks", isAuthenticated, async (req, res) => {
    try {
        const { url, events, secret } = req.body;
        if (!url || !events?.length) return res.status(400).json({ error: "URL and events are required" });
        try { new URL(url); } catch (_) { return res.status(400).json({ error: "Invalid URL" }); }
        
        const webhook = await createWebhook({
            user: req.session.userId,
            url,
            events,
            secret: secret || null
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "CREATE_WEBHOOK",
                category: "user",
                description: `Created webhook: ${url}`,
                targetId: webhook.id,
                targetModel: "Webhook",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Webhook created successfully" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to create webhook" }); }
});

app.delete("/api/settings/webhooks/:id", isAuthenticated, async (req, res) => {
    try {
        const result = await deleteWebhook(req.params.id, req.session.userId);
        if (result.count === 0) return res.status(404).json({ error: "Webhook not found" });
        
        res.json({ success: true, message: "Webhook deleted" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to delete webhook" }); }
});

app.post("/api/settings/backup", isAuthenticated, async (req, res) => {
    try {
        const userData = {
            user: await getUserById(req.session.userId),
            timestamp: new Date()
        };
        delete userData.user.password;
        
        const backup = await createBackup({
            user: req.session.userId,
            name: `Backup-${new Date().toISOString().split("T")[0]}`,
            data: userData,
            size: JSON.stringify(userData).length
        });
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "CREATE_BACKUP",
                category: "user",
                description: "Created manual backup",
                targetId: backup.id,
                targetModel: "Backup",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Backup created successfully" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to create backup" }); }
});

app.get("/api/settings/backup/:id/download", isAuthenticated, async (req, res) => {
    try {
        const backup = await prisma.backup.findFirst({
            where: { id: req.params.id, user: req.session.userId }
        });
        if (!backup) return res.status(404).json({ error: "Backup not found" });
        
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=${backup.name}.json`);
        res.json(backup.data);
    } catch (err) { res.status(500).json({ error: "Failed to download backup" }); }
});

app.post("/api/settings/backup/:id/restore", isAuthenticated, async (req, res) => {
    try {
        const backup = await prisma.backup.findFirst({
            where: { id: req.params.id, user: req.session.userId }
        });
        if (!backup) return res.status(404).json({ error: "Backup not found" });
        
        const { user } = backup.data;
        delete user.password;
        await updateUser(req.session.userId, user);
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "RESTORE_BACKUP",
                category: "user",
                description: `Restored from backup: ${backup.name}`,
                targetId: backup.id,
                targetModel: "Backup",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.json({ success: true, message: "Backup restored successfully" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to restore backup" }); }
});

app.delete("/api/settings/backup/:id", isAuthenticated, async (req, res) => {
    try {
        const result = await prisma.backup.deleteMany({
            where: { id: req.params.id, user: req.session.userId }
        });
        if (result.count === 0) return res.status(404).json({ error: "Backup not found" });
        
        res.json({ success: true, message: "Backup deleted" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to delete backup" }); }
});

app.get("/api/settings/export-data", isAuthenticated, async (req, res) => {
    try {
        const userData = {
            profile: await getUserById(req.session.userId),
            activity: await getAuditLogs({ user: req.session.userId }),
            incidents: await getIncidents({ $or: [{ reportedBy: req.session.userId }, { assignedTo: { has: req.session.userId } }] }),
            patrols: await getPatrols({ guard: req.session.userId }),
            shifts: await getShifts({ guard: req.session.userId }),
            attendance: await getAttendances({ guard: req.session.userId }),
            notifications: await getNotifications({ recipient: req.session.userId })
        };
        delete userData.profile.password;
        
        try {
            await createAuditLog({
                user: req.session.userId,
                action: "EXPORT_DATA",
                category: "user",
                description: "Exported personal data",
                ipAddress: req.ip,
                userAgent: req.get("User-Agent") || "Unknown",
                status: "success"
            });
        } catch (_) {}
        
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=user-data-${req.session.userId}.json`);
        res.json(userData);
    } catch (err) { res.status(500).json({ error: "Failed to export data" }); }
});

app.post("/api/settings/deactivate", isAuthenticated, async (req, res) => {
    try {
        const { password } = req.body;
        const user = await getUserById(req.session.userId);
        if (password) {
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(400).json({ error: "Invalid password" });
        }
        
        await updateUser(req.session.userId, { isActive: false });
        req.session.destroy();
        res.json({ success: true, message: "Account deactivated" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to deactivate account" }); }
});

app.delete("/api/settings/delete", isAuthenticated, async (req, res) => {
    try {
        const { password, confirm } = req.body;
        if (!confirm) return res.status(400).json({ error: "Please confirm account deletion" });
        
        const user = await getUserById(req.session.userId);
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Invalid password" });
        
        await Promise.all([
            prisma.auditLog.deleteMany({ where: { user: req.session.userId } }),
            prisma.notification.deleteMany({ where: { recipient: req.session.userId } }),
            prisma.incident.updateMany({ where: { reportedBy: req.session.userId }, data: { reportedBy: null } }),
            prisma.patrol.updateMany({ where: { guard: req.session.userId }, data: { guard: null } }),
            prisma.shift.updateMany({ where: { guard: req.session.userId }, data: { guard: null } }),
            prisma.attendance.updateMany({ where: { guard: req.session.userId }, data: { guard: null } }),
            prisma.apiKey.deleteMany({ where: { user: req.session.userId } }),
            prisma.webhook.deleteMany({ where: { user: req.session.userId } }),
            prisma.backup.deleteMany({ where: { user: req.session.userId } }),
            prisma.user.delete({ where: { id: req.session.userId } })
        ]);
        
        req.session.destroy();
        res.json({ success: true, message: "Account permanently deleted" });
    } catch (err) { res.status(500).json({ success: false, message: "Failed to delete account" }); }
});

// ================== MISC API ==================

app.get("/api/check-email", async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: "Email is required" });
        const user = await getUserByEmail(email.toLowerCase());
        res.json({ exists: !!user, message: user ? "Email already registered" : "Email available" });
    } catch (err) { res.status(500).json({ error: "Server error checking email" }); }
});

app.get("/api/check-badge", async (req, res) => {
    try {
        const { badgeNumber } = req.query;
        if (!badgeNumber) return res.status(400).json({ error: "Badge number is required" });
        const user = await prisma.user.findUnique({ where: { badgeNumber: badgeNumber.toUpperCase() } });
        res.json({ exists: !!user, message: user ? "Badge number already in use" : "Badge number available" });
    } catch (err) { res.status(500).json({ error: "Server error checking badge number" }); }
});

app.get("/api/check-session", (req, res) => {
    res.json({ loggedIn: !!(req.session?.userId), userId: req.session?.userId, userRole: req.session?.userRole });
});


// keep render active
app.get("/health", async (req, res) => {
    try {
        // Check database connection
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ 
            status: "healthy", 
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({ 
            status: "unhealthy", 
            error: error.message 
        });
    }
});

// Simple ping endpoint
app.get("/ping", (req, res) => {
    res.status(200).send("pong");
});


// ================== ERROR HANDLING ==================

app.use((req, res) => {
    res.status(404).render("error", { title: "404 - Page Not Found", message: "The page you're looking for doesn't exist.", error: {}, layout: false });
});

app.use((err, req, res, next) => {
    console.error("❌ Server error:", err);
    res.status(500).render("error", { title: "500 - Server Error", message: "Something went wrong on our end.", error: process.env.NODE_ENV === "development" ? err : {}, layout: false });
});

// ================== START SERVER ==================

const PORT = process.env.PORT || 3000;
// CRITICAL: Render requires binding to 0.0.0.0, not localhost
const HOST = "0.0.0.0";

// Health check endpoint (required for Render)
app.get("/health", (req, res) => {
    res.status(200).json({ 
        status: "ok", 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: "postgresql"
    });
});

// Connect to database and start server
connectDatabase().then(() => {
    const server = app.listen(PORT, HOST, () => {
        console.log(`🚀 Server running on ${HOST}:${PORT}`);
        console.log(`📡 Database: Neon PostgreSQL`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
        console.log(`✅ Ready to accept connections`);
    });
    
    const shutdown = async (signal) => {
        console.log(`🔄 ${signal}: shutting down...`);
        server.close(async () => {
            await prisma.$disconnect();
            console.log("✅ Connections closed");
            process.exit(0);
        });
    };
    
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("uncaughtException", (err) => {
        console.error("❌ Uncaught Exception:", err);
        shutdown("uncaughtException");
    });
    process.on("unhandledRejection", (reason) => {
        console.error("❌ Unhandled Rejection:", reason);
        shutdown("unhandledRejection");
    });
}).catch(err => {
    console.error("❌ Failed to connect to database:", err);
    process.exit(1);
});

module.exports = app;