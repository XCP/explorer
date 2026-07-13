-- Small, high-frequency lookup indexes proven by the public query plans.

CREATE INDEX idx_prices_currency_day ON prices(currency, day DESC);
