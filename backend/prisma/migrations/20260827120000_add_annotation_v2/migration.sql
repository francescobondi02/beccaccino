ALTER TABLE "AnnotationScenario"
ADD COLUMN "decisionType" TEXT NOT NULL DEFAULT 'play_card';

ALTER TABLE "ExpertAnnotation"
ADD COLUMN "selectedBriscola" "Suit";
