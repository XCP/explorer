# CMC Counterparty acquisition priority

Date: 2026-07-18

The supplied exchange-depositor census prioritizes historical source recovery by observed ecosystem reach. Depositor
count is not price quality and does not admit a source; it identifies where successful recovery may affect the most
participants.

| Priority | Counterparty asset | Exchange depositors | CMC status |
| ---: | --- | ---: | --- |
| 1 | XCP | 10,409 | UCID 132; already imported |
| 2 | FLDC | 5,910 | UCID 606; importer ready |
| 3 | SJCX | 5,706 | UCID 549; importer ready |
| 4 | BITCRYSTALS | 3,878 | UCID 1063; importer ready |
| 5 | LTBCOIN | 2,173 | UCID 550; importer ready |
| 6 | GEMZ | 1,288 | UCID 779; importer ready |
| 7 | PEPECASH | 978 | UCID 1405; importer ready; aggregate corroboration only |
| 8 | DATABITS | 715 | UCID 1603; importer ready |
| 9 | COVALC | 454 | UCID 788 bounded to Counterparty era: 2016-08-07–2019-05-30 |
| 10 | TRIGGERS | 420 | UCID 1423; importer ready |
| 11 | SCOTCOIN | 176 | UCID 346; importer ready |
| 12 | ZAIF | 128 | UCID 1219; importer ready; first-party Zaif paths preferred |
| 13 | SWARM | 116 | UCID 607; importer ready |
| 14 | TILECOINX | 103 | UCID 694; importer ready |
| 15 | CICC | 32 | No CMC identity; first-party Zaif paths available |

After XCP, the recommended authorized-API acquisition order is FLDC, SJCX, BITCRYSTALS, LTBCOIN, GEMZ, PEPECASH,
DATABITS, and TRIGGERS. Each import remains a non-selecting CMC aggregate observation until overlap, trade-lane, and
identity audits pass. COVALC must not be fetched as one continuous Counterparty series; only its bounded era is valid.
