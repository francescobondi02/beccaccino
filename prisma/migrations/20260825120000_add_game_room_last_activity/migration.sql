-- Existing rooms receive a deployment-time grace period before inactivity
-- cleanup can remove them.
ALTER TABLE "GameRoom"
ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
