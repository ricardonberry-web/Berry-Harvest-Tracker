# MirtiloTrack — Sistema de Pesagem de Mirtilo

## Visão Geral

PWA para Android (Chrome) que regista pesagens de caixas de mirtilo em campo. Comunica com uma balança **FFN Baxtran** via RS-232 (USB-OTG + conversor FTDI) usando a Web Serial API. Trabalhadores identificados por QR code; só são autorizadas pesagens de quem deu entrada nesse dia. Ranking diário e exportação CSV.

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **TypeScript**: 5.9
- **API**: Express 5 + Drizzle ORM + PostgreSQL
- **Frontend**: React + Vite (PWA) + Tailwind CSS + shadcn/ui
- **API codegen**: Orval (OpenAPI → React Query hooks + Zod schemas)
- **Build**: esbuild

## Estrutura

```text
├── artifacts/
│   ├── api-server/         # Express API — porta 8080, rota /api
│   └── mirtilo-app/        # React + Vite PWA — rota /
├── lib/
│   ├── api-spec/           # OpenAPI 3.1 spec + Orval config
│   ├── api-client-react/   # React Query hooks gerados
│   ├── api-zod/            # Zod schemas gerados
│   └── db/                 # Drizzle schema + ligação PostgreSQL
└── scripts/                # Scripts utilitários
```

## Base de Dados

**Tabelas:**
- `workers` — trabalhadores (id, name, active, createdAt)
- `weigh_records` — pesagens (id, workerId, weightGrams, unit, scaleId, rawLine, timestamp)
- `worker_attendance` — entradas/saídas diárias (id, workerId, date, checkInAt, checkOutAt). Único por (workerId, date).

**Seed inicial:** W001–W004 (Maria Silva, João Costa, Ana Pereira, Carlos Matos)

## API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/healthz` | Health check |
| GET | `/api/workers` | Lista trabalhadores |
| POST | `/api/workers` | Cria trabalhador |
| GET | `/api/workers/:id` | Trabalhador por ID |
| PATCH | `/api/workers/:id` | Actualiza trabalhador |
| DELETE | `/api/workers/:id` | Remove trabalhador |
| GET | `/api/weigh-records` | Lista pesagens (filtros: workerId, date, limit) |
| POST | `/api/weigh-records` | Regista pesagem (rejeita 403 se trabalhador sem entrada) |
| DELETE | `/api/weigh-records/:id` | Remove pesagem |
| GET | `/api/attendance?date=` | Lista entradas/saídas de um dia (default: hoje) |
| POST | `/api/attendance/check-in` | Entrada de um trabalhador |
| POST | `/api/attendance/check-out` | Saída de um trabalhador |
| POST | `/api/attendance/check-in-all` | Entrada em massa (body: `{workerIds?: string[]}` — opcional; se omitido aplica a todos os activos; reabre quem já tinha saído) |
| POST | `/api/attendance/check-out-all` | Saída em massa (body: `{workerIds?: string[]}` — opcional; se omitido aplica a todos os que ainda estão no terreno) |
| GET | `/api/reports/daily?date=YYYY-MM-DD` | Ranking diário por kg |
| GET | `/api/reports/export?date=YYYY-MM-DD` | Exporta CSV |
| GET | `/api/workers/:id/timesheet?from=&to=&hourlyRate=` | Folha de horas: dias trabalhados, total horas e valor a pagar |
| GET | `/api/workers/:id/timesheet/export?from=&to=&hourlyRate=` | Exporta folha de horas em CSV |

## Frontend — Páginas

- **`/`** — Pesagem: identificação do trabalhador (QR ou manual), modos Balança e Manual, botão de registo, histórico do dia. Bloqueia se o trabalhador não tem entrada nesse dia.
- **`/attendance`** — Entradas/Saídas diárias: caixa de selecção por trabalhador + barra fixa com 2 botões "Entrada (N)" e "Saída (N)" que aplicam a acção apenas aos seleccionados. Mostra hora de entrada, saída e total trabalhado.
- **`/ranking`** — Ranking diário: filtro por data, ordenação por kg/kg-h/caixas/horas, opção "só com horas registadas", colunas Horas e **Kg/h** (calculados a partir de check-in/check-out reais), kg/h da equipa, exportação CSV.
- **`/workers`** — Gestão de trabalhadores: listagem, pesquisa, criação, badges QR e **Folha de Horas** (modal por trabalhador com filtro de datas, valor/hora editável, cálculo automático do valor a pagar e exportação CSV).

## Componentes-chave

- `ChecklistModal.tsx` — Modal de verificação diária obrigatório (localStorage para controlo diário)
- `Layout.tsx` — Header com estado da balança FFN Baxtran + navegação inferior (4 separadores)
- `use-scale.ts` — Hook Web Serial API (9600 8N1, parser regex `ST,GS:`)
- `use-qr-scanner.ts` — Hook jsQR para scanner de câmara
- `use-beep.ts` — Feedback sonoro (sucesso, erro, aviso)

## Protocolo FFN Baxtran

- Baud: 9600 | Data: 8 | Parity: None | Stop: 1 | Modo: StC
- Formato: `ST,GS: X.XXXXkg\r\n`
- Overload: `----` | Underload: `lo -` | Bateria baixa: `bA lo`
- DB9 pin 2(RXD)↔3(TXD), pin 5(GND)
- `scaleId` registado: `FFN-BAXTRAN-01` (balança) ou `MANUAL-MANUAL` (entrada manual)

## Modos de Pesagem

A página de pesagem tem 2 modos seleccionáveis por separadores:

| Modo | Descrição |
|------|-----------|
| **Balança** | Leitura directa via Web Serial API (FFN Baxtran) |
| **Manual** | Campo numérico para introdução directa em gramas |

O botão "REGISTAR" usa a fonte activa. O histórico do dia mostra a origem de cada pesagem com cor e ícone.

## Módulo Entradas/Saídas

- Cada trabalhador faz uma única entrada/saída por dia (registo idempotente).
- Pesagens só são aceites se houver entrada activa (sem saída) nesse dia — caso contrário API devolve 403.
- Botões "Entrada — Todos" e "Saída — Todos" para arranque e fim de dia em massa.
- Horas trabalhadas calculadas como `(checkOutAt − checkInAt)` em horas decimais.

## Anti-error UX

- Peso válido: **50 g – 10 000 g**
- Bloqueio de pesagem se trabalhador sem entrada para hoje (com link directo para Entradas/Saídas)
- Confirmação para re-pesagem em menos de 15 s
- Debounce de 1.5 s no botão de registo
- Checklist diário obrigatório ao lançar a app

## Workflows

- `artifacts/api-server: API Server` — dev server do backend
- `artifacts/mirtilo-app: web` — dev server do frontend

## Comandos Úteis

```bash
# Codegen OpenAPI → hooks/schemas
pnpm --filter @workspace/api-spec run codegen

# Push schema para DB
pnpm --filter @workspace/db run push

# Build API
pnpm --filter @workspace/api-server run build

# Build Frontend
pnpm --filter @workspace/mirtilo-app run build
```

## TypeScript & Composite Projects

- `tsconfig.base.json` — opções partilhadas (composite, bundler resolution, es2022)
- `tsc --build --emitDeclarationOnly` — typecheck completo (correr da raiz)
- Cada package tem `references` para os seus deps no tsconfig
