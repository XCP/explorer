<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

$appRoot = $argv[1] ?? (__DIR__ . '/../../../../api.xcp.io');
require $appRoot . '/vendor/autoload.php';
$app = require $appRoot . '/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$summary = DB::selectOne(<<<'SQL'
    SELECT COUNT(*) total,
           SUM(is_spent = 0) unspent,
           SUM(is_recoverable = 1) recoverable,
           SUM(is_spent = 0 AND is_recoverable = 1) unspent_recoverable,
           SUM(is_spent = 1 AND is_recoverable = 1) recoverable_spent,
           SUM(is_spent = 0 AND is_recoverable = 0) unspent_not_recoverable,
           SUM(script_type = 'bare_multisig_1_of_2') one_of_two,
           SUM(script_type = 'bare_multisig_1_of_3') one_of_three,
           SUM(prev_tx_hex IS NOT NULL) prev_tx_rows,
           COUNT(DISTINCT CASE WHEN prev_tx_hex IS NOT NULL THEN txid END) unique_prev_txs,
           SUM(sign_type = 'invalid-pubkeys') sign_invalid,
           SUM(sign_type = 'compressed') sign_compressed,
           SUM(sign_type = 'uncompressed') sign_uncompressed,
           SUM(sign_type IN ('valid-mixed', 'valid-pubkeys')) sign_mixed,
           SUM(sign_type IS NULL) sign_null
      FROM utxos
SQL);

$classifications = DB::select(<<<'SQL'
    SELECT script_type, COALESCE(sign_type, 'unknown') sign_type,
           is_recoverable, is_spent, COUNT(*) outputs
      FROM utxos
     GROUP BY script_type, sign_type, is_recoverable, is_spent
     ORDER BY script_type, sign_type, is_recoverable, is_spent
SQL);

$tableSizes = DB::select(<<<'SQL'
    SELECT table_name,
           table_rows estimated_rows,
           data_length data_bytes,
           index_length index_bytes
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('utxos', 'pubkey_addresses', 'utxo_pubkey_address', 'consolidation_reports')
     ORDER BY table_name
SQL);

$relationshipCounts = [
    'utxo_pubkey_address' => DB::table('utxo_pubkey_address')->count(),
    'pubkey_addresses' => DB::table('pubkey_addresses')->count(),
    'consolidation_reports' => DB::table('consolidation_reports')->count(),
];

echo json_encode(
    [
        'summary' => $summary,
        'classifications' => $classifications,
        'relationships' => $relationshipCounts,
        'tables' => $tableSizes,
    ],
    JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR,
), PHP_EOL;
