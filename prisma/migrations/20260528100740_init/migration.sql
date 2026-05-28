-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'supervisor', 'guard', 'student');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('theft', 'vandalism', 'unauthorized_access', 'fire', 'medical_emergency', 'suspicious_activity', 'accident', 'assault', 'harassment', 'noise_complaint', 'property_damage', 'other');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('reported', 'acknowledged', 'investigating', 'in_progress', 'resolved', 'closed', 'false_alarm');

-- CreateEnum
CREATE TYPE "PatrolStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'interrupted', 'cancelled', 'missed');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'missed', 'cancelled');

-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('main_gate', 'hostels', 'academic', 'perimeter', 'parking', 'admin');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'late', 'early_departure', 'half_day');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('alert', 'reminder', 'info', 'warning', 'emergency');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "CheckpointType" AS ENUM ('qr', 'nfc', 'manual');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('incident_summary', 'patrol_report', 'attendance_report', 'shift_report', 'custom', 'backup');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('pdf', 'excel', 'csv', 'json');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'generating', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('auth', 'incident', 'patrol', 'shift', 'user', 'system', 'api', 'webhook', 'backup', 'support');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('success', 'failure', 'pending');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('read', 'write', 'delete', 'admin');

-- CreateEnum
CREATE TYPE "WebhookEvent" AS ENUM ('incident_created', 'incident_updated', 'incident_resolved', 'patrol_started', 'patrol_completed', 'patrol_interrupted', 'shift_assigned', 'shift_reminder', 'shift_completed', 'user_login', 'user_logout', 'test');

-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('manual', 'scheduled', 'automatic');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('completed', 'failed', 'in_progress');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('technical', 'account', 'billing', 'feature', 'incident', 'other');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateTable
CREATE TABLE "sessions" (
    "sid" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'student',
    "badge_number" TEXT,
    "phone_number" TEXT,
    "institution" TEXT,
    "profile_image" TEXT DEFAULT 'default-avatar.png',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login" TIMESTAMP(3),
    "location" JSONB,
    "location_last_updated" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "shift_preferences" JSONB,
    "emergency_contact" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "date_format" TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
    "time_format" TEXT NOT NULL DEFAULT '12h',
    "first_day_of_week" TEXT NOT NULL DEFAULT 'sunday',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "compact_mode" BOOLEAN NOT NULL DEFAULT false,
    "reduce_animations" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "country" TEXT NOT NULL DEFAULT 'KE',
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "measurement" TEXT NOT NULL DEFAULT 'metric',
    "session_timeout" INTEGER NOT NULL DEFAULT 30,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_secret" TEXT,
    "login_alerts" BOOLEAN NOT NULL DEFAULT true,
    "password_last_changed" TIMESTAMP(3),
    "notification_settings" JSONB,
    "privacy_settings" JSONB,
    "accessibility_settings" JSONB,
    "integration_settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'medium',
    "status" "IncidentStatus" NOT NULL DEFAULT 'reported',
    "location" JSONB NOT NULL,
    "reported_by" TEXT NOT NULL,
    "assigned_to" TEXT[],
    "witnesses" JSONB,
    "media" JSONB,
    "timeline" JSONB,
    "response_time" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patrols" (
    "id" TEXT NOT NULL,
    "guard" TEXT NOT NULL,
    "supervisor" TEXT,
    "shift" TEXT,
    "route" JSONB,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "scheduled_end_time" TIMESTAMP(3),
    "status" "PatrolStatus" NOT NULL DEFAULT 'scheduled',
    "checkpoints" JSONB,
    "path" JSONB,
    "incidents" TEXT[],
    "notes" TEXT,
    "weather" JSONB,
    "stats" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patrols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "guard" TEXT NOT NULL,
    "supervisor" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "zone" "ZoneType" NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'scheduled',
    "check_in" JSONB,
    "check_out" JSONB,
    "overtime" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" TEXT NOT NULL,
    "guard" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "check_in" JSONB,
    "check_out" JSONB,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'present',
    "working_hours" DOUBLE PRECISION,
    "overtime" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "related_to" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkpoints" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "location" JSONB NOT NULL,
    "zone" "ZoneType" NOT NULL,
    "type" "CheckpointType" NOT NULL DEFAULT 'qr',
    "qr_code" TEXT,
    "nfc_tag" TEXT,
    "description" TEXT,
    "instructions" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_scanned" TIMESTAMP(3),
    "last_scanned_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "generated_by" TEXT NOT NULL,
    "date_range" JSONB,
    "data" JSONB,
    "format" "ReportFormat" NOT NULL DEFAULT 'pdf',
    "file_url" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "description" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "changes" JSONB,
    "target_id" TEXT,
    "target_model" TEXT,
    "status" "AuditStatus" NOT NULL DEFAULT 'success',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "permissions" "Permission"[] DEFAULT ARRAY['read']::"Permission"[],
    "last_used" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" "WebhookEvent"[],
    "secret" TEXT,
    "last_triggered" TIMESTAMP(3),
    "last_response" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backups" (
    "id" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BackupType" NOT NULL DEFAULT 'manual',
    "data" JSONB NOT NULL,
    "size" INTEGER NOT NULL,
    "file_url" TEXT,
    "status" "BackupStatus" NOT NULL DEFAULT 'completed',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "assigned_to" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "attachments" JSONB,
    "messages" JSONB,
    "related_to" JSONB,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "incidentId" TEXT,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PatrolIncidents" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PatrolIncidents_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_badge_number_key" ON "users"("badge_number");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "users_badge_number_idx" ON "users"("badge_number");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_severity_idx" ON "incidents"("severity");

-- CreateIndex
CREATE INDEX "incidents_created_at_idx" ON "incidents"("created_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_reported_by_idx" ON "incidents"("reported_by");

-- CreateIndex
CREATE INDEX "patrols_guard_idx" ON "patrols"("guard");

-- CreateIndex
CREATE INDEX "patrols_status_idx" ON "patrols"("status");

-- CreateIndex
CREATE INDEX "patrols_start_time_idx" ON "patrols"("start_time" DESC);

-- CreateIndex
CREATE INDEX "shifts_guard_idx" ON "shifts"("guard");

-- CreateIndex
CREATE INDEX "shifts_date_idx" ON "shifts"("date");

-- CreateIndex
CREATE INDEX "shifts_status_idx" ON "shifts"("status");

-- CreateIndex
CREATE INDEX "shifts_zone_idx" ON "shifts"("zone");

-- CreateIndex
CREATE INDEX "attendances_guard_idx" ON "attendances"("guard");

-- CreateIndex
CREATE INDEX "attendances_date_idx" ON "attendances"("date" DESC);

-- CreateIndex
CREATE INDEX "attendances_status_idx" ON "attendances"("status");

-- CreateIndex
CREATE INDEX "notifications_recipient_idx" ON "notifications"("recipient");

-- CreateIndex
CREATE INDEX "notifications_read_idx" ON "notifications"("read");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_priority_idx" ON "notifications"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "checkpoints_code_key" ON "checkpoints"("code");

-- CreateIndex
CREATE INDEX "checkpoints_code_idx" ON "checkpoints"("code");

-- CreateIndex
CREATE INDEX "checkpoints_zone_idx" ON "checkpoints"("zone");

-- CreateIndex
CREATE INDEX "checkpoints_is_active_idx" ON "checkpoints"("is_active");

-- CreateIndex
CREATE INDEX "audit_logs_user_idx" ON "audit_logs"("user");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_category_idx" ON "audit_logs"("category");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "api_keys_user_idx" ON "api_keys"("user");

-- CreateIndex
CREATE INDEX "api_keys_key_idx" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "api_keys_expires_at_idx" ON "api_keys"("expires_at");

-- CreateIndex
CREATE INDEX "api_keys_is_active_idx" ON "api_keys"("is_active");

-- CreateIndex
CREATE INDEX "webhooks_user_idx" ON "webhooks"("user");

-- CreateIndex
CREATE INDEX "webhooks_is_active_idx" ON "webhooks"("is_active");

-- CreateIndex
CREATE INDEX "backups_user_idx" ON "backups"("user");

-- CreateIndex
CREATE INDEX "backups_created_at_idx" ON "backups"("created_at" DESC);

-- CreateIndex
CREATE INDEX "backups_type_idx" ON "backups"("type");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticket_id_key" ON "support_tickets"("ticket_id");

-- CreateIndex
CREATE INDEX "support_tickets_ticket_id_idx" ON "support_tickets"("ticket_id");

-- CreateIndex
CREATE INDEX "support_tickets_created_by_idx" ON "support_tickets"("created_by");

-- CreateIndex
CREATE INDEX "support_tickets_assigned_to_idx" ON "support_tickets"("assigned_to");

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");

-- CreateIndex
CREATE INDEX "support_tickets_priority_idx" ON "support_tickets"("priority");

-- CreateIndex
CREATE INDEX "support_tickets_created_at_idx" ON "support_tickets"("created_at" DESC);

-- CreateIndex
CREATE INDEX "_PatrolIncidents_B_index" ON "_PatrolIncidents"("B");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patrols" ADD CONSTRAINT "patrols_guard_fkey" FOREIGN KEY ("guard") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patrols" ADD CONSTRAINT "patrols_supervisor_fkey" FOREIGN KEY ("supervisor") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_guard_fkey" FOREIGN KEY ("guard") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_supervisor_fkey" FOREIGN KEY ("supervisor") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_guard_fkey" FOREIGN KEY ("guard") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_fkey" FOREIGN KEY ("recipient") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_last_scanned_by_fkey" FOREIGN KEY ("last_scanned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_fkey" FOREIGN KEY ("user") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_fkey" FOREIGN KEY ("user") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_user_fkey" FOREIGN KEY ("user") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backups" ADD CONSTRAINT "backups_user_fkey" FOREIGN KEY ("user") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PatrolIncidents" ADD CONSTRAINT "_PatrolIncidents_A_fkey" FOREIGN KEY ("A") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PatrolIncidents" ADD CONSTRAINT "_PatrolIncidents_B_fkey" FOREIGN KEY ("B") REFERENCES "patrols"("id") ON DELETE CASCADE ON UPDATE CASCADE;
