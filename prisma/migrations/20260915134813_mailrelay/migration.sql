-- AlterTable
ALTER TABLE "Segment" ADD COLUMN "mailrelayGroupId" INTEGER;
ALTER TABLE "Segment" ADD COLUMN "mailrelayGroupName" TEXT;
ALTER TABLE "Segment" ADD COLUMN "mailrelaySyncedAt" DATETIME;
ALTER TABLE "Segment" ADD COLUMN "mailrelaySyncedCount" INTEGER;
