ALTER TABLE dispenses ADD COLUMN dispense_id INTEGER;
CREATE UNIQUE INDEX idx_dispenses_dispense_id ON dispenses(dispense_id) WHERE dispense_id IS NOT NULL;
