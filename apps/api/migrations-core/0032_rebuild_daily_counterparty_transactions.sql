UPDATE daily_metrics SET transactions=NULL;

INSERT INTO daily_metrics(day,transactions)
SELECT block_time/86400,SUM(transaction_count)
FROM blocks
WHERE block_time>0 AND transaction_count IS NOT NULL
GROUP BY block_time/86400
ON CONFLICT(day) DO UPDATE SET transactions=excluded.transactions;
