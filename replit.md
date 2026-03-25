# MirtiloTrack — Sistema de Pesagem de Mirtilo

## Visão Geral

PWA para Android (Chrome) que regista pesagens de caixas de mirtilo em campo. Comunica com uma balança Baxtran XTA via RS-232 (USB-OTG + conversor FTDI) usando a Web Serial API. Trabalhadores identificados por QR code; ranking diário e exportação CSV.

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

**Seed inicial:** W001–W004 (Maria Silva, João Costa, Ana Pereira, Carlos Matos)

## API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/healthz` | Health check |
| GET | `/api/workers` | Lista trabalhadores |
| POST | `/api/workers` | Cria trabalhador |
| GET | `/api/workers/:id` | Trabalhador por ID |
| PUT | `/api/workers/:id` | Actualiza trabalhador |
| GET | `/api/weigh-records` | Lista pesagens (filtros: workerId, date, limit) |
| POST | `/api/weigh-records` | Regista pesagem |
| DELETE | `/api/weigh-records/:id` | Remove pesagem |
| GET | `/api/reports/daily?date=YYYY-MM-DD` | Ranking diário por kg |
| GET | `/api/reports/export?date=YYYY-MM-DD` | Exporta CSV |

## Frontend — Páginas

- **`/`** — Página de pesagem: identificação do trabalhador (QR ou manual), leitura ao vivo da balança, botão de registo, histórico do dia
- **`/ranking`** — Ranking diário: tabela por trabalhador com total kg, caixas, média, caixas/hora; exportação CSV
- **`/workers`** — Gestão de trabalhadores: listagem, pesquisa, criação, visualização e impressão de badges QR

## Componentes-chave

- `ChecklistModal.tsx` — Modal de verificação diária obrigatório (localStorage para controlo diário)
- `Layout.tsx` — Header com estado da balança + navegação inferior
- `use-scale.ts` — Hook Web Serial API (9600 8N1, Baxtran XTA, parser regex `ST,GS:`)
- `use-qr-scanner.ts` — Hook jsQR para scanner de câmara
- `use-beep.ts` — Feedback sonoro (sucesso, erro, aviso)

## Protocolo Baxtran XTA

- Baud: 9600 | Data: 8 | Parity: None | Stop: 1 | Modo: StC
- Formato: `ST,GS: X.XXXXkg\r\n`
- Overload: `----` | Underload: `lo -` | Bateria baixa: `bA lo`
- DB9 pin 2(RXD)↔3(TXD), pin 5(GND)

## Redundâncias de Pesagem

A página de pesagem tem 3 modos seleccionáveis por separadores:

| Modo | Descrição |
|------|-----------|
| **Balança** | Leitura directa via Web Serial API (Baxtran XTA) |
| **Manual** | Campo numérico para introdução directa em gramas |
| **IA / Foto** | Tirar foto ao visor → GPT-4o Vision lê o valor |

O botão "REGISTAR" usa a fonte activa e o `scaleId` regista a origem (`BAXTRAN-XTA-01`, `MANUAL-MANUAL`, `MANUAL-IA`). O histórico do dia mostra a origem de cada pesagem com cor e ícone.

### Endpoint IA
`POST /api/scale/read-photo` — aceita `imageBase64` + `mimeType`, devolve `{grams: number}` ou `{grams: null, error: string}`. Usa GPT-4o Vision via Replit AI Integrations (sem chave API própria necessária).

## Anti-error UX

- Peso válido: 50g–5100g
- Confirmação para re-pesagem em menos de 15s
- Debounce de 1.5s no botão de registo
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
