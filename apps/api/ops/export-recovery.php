<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

$appRoot = $argv[1] ?? (__DIR__ . '/../../../../api.xcp.io');
$afterId = isset($argv[2]) ? max(0, (int) $argv[2]) : 0;
$limit = isset($argv[3]) ? min(100, max(1, (int) $argv[3])) : 100;

require $appRoot . '/vendor/autoload.php';
$app = require $appRoot . '/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$rows = DB::table('utxos')
    ->select([
        'id',
        'txid',
        'vout',
        'value',
        'script_hex',
        'prev_tx_hex',
        'block_height',
        'created_at_utc',
        'is_spent',
        'is_recoverable',
        'sign_type',
        'spending_txid',
    ])
    ->where('id', '>', $afterId)
    ->whereIn('script_type', ['bare_multisig_1_of_2', 'bare_multisig_1_of_3'])
    ->whereNotNull('script_hex')
    ->whereNotNull('prev_tx_hex')
    ->orderBy('id')
    ->limit($limit)
    ->get();

$addressRows = $rows->isEmpty()
    ? collect()
    : DB::table('utxo_pubkey_address as relation')
        ->join('pubkey_addresses as address', 'address.id', '=', 'relation.pubkey_address_id')
        ->whereIn('relation.utxo_id', $rows->pluck('id'))
        ->select(['relation.utxo_id', 'relation.position', 'address.address'])
        ->get()
        ->groupBy('utxo_id');

$transactions = [];
foreach ($rows as $row) {
    // Historical rows occasionally mark an output spent without retaining a valid
    // transaction id. Treat that value as unknown; Electrs reconciliation is the
    // authoritative source for spent state and will populate it when resolvable.
    $spendingTxid = is_string($row->spending_txid)
        && strlen($row->spending_txid) === 64
        && ctype_xdigit($row->spending_txid)
            ? strtolower($row->spending_txid)
            : null;
    if (!isset($transactions[$row->txid])) {
        $transactions[$row->txid] = [
            'txid' => strtolower($row->txid),
            'raw_transaction_hex' => strtolower($row->prev_tx_hex),
            'outputs' => [],
        ];
    }
    $transactions[$row->txid]['outputs'][] = [
        'vout' => (int) $row->vout,
        'value_sats' => (int) $row->value,
        'script_pubkey_hex' => strtolower($row->script_hex),
        'block_height' => $row->block_height === null ? null : (int) $row->block_height,
        'block_time' => $row->created_at_utc === null ? null : strtotime((string) $row->created_at_utc),
        'spent_by_txid' => $row->is_spent ? $spendingTxid : null,
        'spent_height' => null,
        'source_id' => (int) $row->id,
        'source_recoverable' => (bool) $row->is_recoverable,
        'source_sign_type' => $row->sign_type,
        'source_addresses' => ($addressRows->get($row->id) ?? collect())
            ->map(fn ($relation) => [
                'address' => $relation->address,
                'position' => (int) $relation->position,
            ])
            ->values()
            ->all(),
    ];
}

echo json_encode([
    'after_id' => $afterId,
    'next_id' => $rows->isEmpty() ? null : (int) $rows->last()->id,
    'rows' => $rows->count(),
    'transactions' => array_values($transactions),
], JSON_THROW_ON_ERROR), PHP_EOL;
