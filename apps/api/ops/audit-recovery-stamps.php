<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

$appRoot = $argv[1] ?? (__DIR__ . '/../../../../api.xcp.io');
require $appRoot . '/vendor/autoload.php';
$app = require $appRoot . '/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

// The former service's is_stamp flag has two producers: the Stampchain API and
// a script-shape heuristic. This audit describes that historical overlay; it is
// intentionally not treated as authoritative Stampchain parity.
$summary = DB::selectOne(<<<'SQL'
    SELECT COUNT(*) outputs,
           SUM(is_spent = 0) unspent_outputs,
           SUM(is_recoverable = 1) recoverable_outputs,
           SUM(is_spent = 0 AND is_recoverable = 1) unspent_recoverable_outputs
      FROM utxos
SQL);

$marked = DB::selectOne(<<<'SQL'
    SELECT COUNT(*) outputs,
           SUM(is_spent = 0) unspent_outputs,
           SUM(is_recoverable = 1) recoverable_outputs,
           SUM(is_spent = 0 AND is_recoverable = 1) unspent_recoverable_outputs
      FROM utxos
     WHERE is_stamp = 1
SQL);

$markedByShape = DB::select(<<<'SQL'
    SELECT script_type,
           COALESCE(sign_type, 'unknown') sign_type,
           is_recoverable,
           is_spent,
           COUNT(*) outputs
      FROM utxos
     WHERE is_stamp = 1
     GROUP BY script_type, sign_type, is_recoverable, is_spent
     ORDER BY script_type, sign_type, is_recoverable, is_spent
SQL);

echo json_encode([
    'warning' => 'Historical is_stamp combines Stampchain transaction matches with a data-pubkey heuristic.',
    'summary' => $summary,
    'marked' => $marked,
    'marked_by_shape' => $markedByShape,
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), PHP_EOL;
