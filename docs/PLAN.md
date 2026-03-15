# Tank Battle Royale — Multiplayer Game Project

## Project overview

University course project: a multiplayer tank battle royale game built with Unity (client + dedicated headless server), three containerized backend microservices on AWS ECS, and GameLift for game server hosting and matchmaking.

This is a **learning project** — the team is new to Unity but has strong backend/distributed systems experience. Prioritize simplicity, clear code, and extensive comments over production polish.

**Course constraints**: Docker and ECS are hard requirements for the backend services. Must use two different data stores (one SQL, one NoSQL).

## Architecture

```
                        ┌─────────────────────────────────┐
                        │     GameLift + FlexMatch         │
                        │  (matchmaking + fleet mgmt)      │
                        └──────────┬──────────────────────┘
                                   │ provisions server,
                                   │ returns IP + port
                                   ▼
                        ┌─────────────────────────────────┐
                        │     Dedicated Game Server        │
                        │   (Unity Headless on GameLift)   │
                        └────▲────────────────────┬───────┘
                             │                    │
              Direct UDP     │                    │ HTTP POST /stats/matches
              (gameplay)     │                    │ (when match ends)
                             │                    │
┌────────────────────────────┼────────────────────┼───────────────────────┐
│                            │                    │                        │
│  Unity Client ─────────────┘                    │                        │
│       │                                         │                        │
│       │ HTTP (all requests go to /api/v1/*)     │                        │
│       ▼                                         ▼                        │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  ALB (Application Load Balancer) — acts as API gateway              │ │
│  │  routes by path:                                                     │ │
│  │    /api/v1/register, /api/v1/login, /api/v1/me  → Auth Service      │ │
│  │    /api/v1/join, /api/v1/match-status/*          → Matchmaking Svc  │ │
│  │    /api/v1/matches, /api/v1/players/*, /api/v1/leaderboard → Stats  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│       │                          │                         │              │
│       ▼                          ▼                         ▼              │
│  ┌──────────────────── ECS Fargate (Docker) ──────────────────────────┐ │
│  │                                                                     │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │ │
│  │  │  Auth Service     │  │  Matchmaking     │  │  Stats Service   │  │ │
│  │  │  register, login  │  │  Service         │  │  match results,  │  │ │
│  │  │  user profile     │  │  join, poll      │  │  player stats,   │  │ │
│  │  │  [no JWT needed]  │  │  [JWT required]  │  │  leaderboard     │  │ │
│  │  └────────┬──────────┘  └────────┬─────────┘  └────────┬─────────┘  │ │
│  │           │                      │                      │            │ │
│  └───────────┼──────────────────────┼──────────────────────┼────────────┘ │
│              │                      │                      │              │
│              ▼                      ▼                      ▼              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │  PostgreSQL (RDS) │  │  DynamoDB         │  │  PostgreSQL (RDS) │      │
│  │  users table      │  │  tickets,         │  │  matches,         │     │
│  │                   │  │  sessions         │  │  match_players    │     │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
│   (same RDS instance,   (separate service)    (same RDS instance,        │
│    auth schema)                                stats schema)              │
└──────────────────────────────────────────────────────────────────────────┘
```

### Flow

1. **Register/Login** → Unity client calls `POST /api/v1/register` or `POST /api/v1/login`. ALB routes to Auth Service. Auth Service hashes password, stores/verifies in PostgreSQL, returns a JWT.
2. **Find match** → Client sends JWT to `POST /api/v1/join`. ALB routes to Matchmaking Service. Service validates JWT (via FastAPI dependency), calls GameLift FlexMatch `StartMatchmaking`, and stores the ticket in DynamoDB for fast polling.
3. **Poll for match** → Client polls `GET /api/v1/match-status/{ticket_id}`. Service checks DynamoDB cache first, falls back to `DescribeMatchmaking` on GameLift if needed. When FlexMatch has grouped enough players and provisioned a server, it returns the game session connection info.
4. **Match ready** → Client receives IP + port + player session ID. Session info is stored in DynamoDB (GameSessions table).
5. **Gameplay** → Client opens direct UDP connection to the dedicated server. All game state (movement, shooting, damage, elimination) flows over UDP. No more HTTP.
6. **Game ends** → Server reports results to GameLift. Server calls `POST /api/v1/matches` (routed to Stats Service) with match results (kills, placements, duration). Stats Service writes to PostgreSQL. DynamoDB session entry auto-expires via TTL. Client returns to lobby.
7. **View stats** → Client can call `GET /api/v1/players/{id}` or `GET /api/v1/leaderboard` (routed to Stats Service) to show player profiles and leaderboards.

### Future: Kafka integration

The current design has the game server calling the Stats Service directly via HTTP when a match ends. This is the seam where Kafka fits later:

```
Current:  Game Server ──HTTP POST──▶ Stats Service ──▶ PostgreSQL
Future:   Game Server ──publish──▶ Kafka topic ──consume──▶ Stats Service ──▶ PostgreSQL
```

When Kafka is added, the Stats Service becomes a consumer — zero changes to auth or matchmaking. The game server publishes a `match.ended` event with all results, and the Stats Service processes it asynchronously. Other consumers (analytics, notifications) can subscribe to the same topic.

### Key decisions

- **Server authoritative**: The dedicated server owns all game state. Clients send inputs (move direction, shoot command); server validates, simulates, and broadcasts results. This prevents cheating.
- **Three microservices, single responsibility each**:
  - Auth Service: identity only (register, login, JWT).
  - Matchmaking Service: matchmaking only (start match, poll status).
  - Stats Service: game data only (match results, player stats, leaderboards).
- **FlexMatch for matchmaking**: No custom matchmaking queue. GameLift's built-in FlexMatch handles player grouping with configurable rules. The ECS matchmaking service is a thin wrapper that calls FlexMatch via the AWS SDK.
- **Custom auth (no Cognito)**: FastAPI Auth Service + PostgreSQL handles registration, login, password hashing (bcrypt), and JWT issuance directly. No AWS Cognito dependency — simpler, full control.
- **SQL + NoSQL split (course requirement)**: PostgreSQL (RDS) for relational data — users, match history, player stats — where joins matter. DynamoDB for ephemeral/high-throughput data — matchmaking tickets, live game sessions — where you only need key-value lookups and want TTL for automatic cleanup.
- **Shared RDS, separate schemas**: Auth and Stats services share the same RDS instance but use separate PostgreSQL schemas (`auth` and `stats`). For a course project this keeps costs down while maintaining logical separation. Each service only has credentials for its own schema.
- **ALB as API gateway**: The Application Load Balancer acts as the single entry point for all client HTTP requests. The client only knows one URL (the ALB's DNS). The ALB routes requests by path to the correct ECS service. No AWS API Gateway needed — the ALB does path-based routing natively and is already required for ECS Fargate services.
- **JWT validation at the service level**: No centralized auth middleware or Lambda authorizer. Auth logic lives in a shared Python package (`services/shared/`) imported by all services. FastAPI's router-level dependencies apply it once per router — not per endpoint. Add a new service or 50 new endpoints with zero extra auth code.
- **ECS Fargate for backend services**: All three FastAPI services run as Docker containers on ECS Fargate. Satisfies the course Docker/ECS requirement.
- **GameLift for game servers**: The dedicated Unity headless servers run on GameLift managed EC2 fleets (NOT on ECS). GameLift handles auto-scaling, session management, health checks, and server lifecycle — things that would take weeks to build on ECS.
- **Polling over SNS**: For simplicity, the client polls the matchmaking service for match status instead of setting up an SNS → SQS → websocket notification pipeline. Polling every 2-3 seconds is fine for a course project.

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Game client | Unity 2022 LTS, C# | Netcode for GameObjects (NGO) for networking |
| Game server | Unity Headless build, C# | Same Unity project, built with `SERVER` scripting define, runs on GameLift |
| Networking | Netcode for GameObjects (NGO) | Server authoritative, uses Unity Transport (UDP) |
| Auth service | FastAPI + Python 3.12 | Dockerized, runs on ECS Fargate |
| Matchmaking service | FastAPI + Python 3.12 | Dockerized, runs on ECS Fargate, calls GameLift API |
| Stats service | FastAPI + Python 3.12 | Dockerized, runs on ECS Fargate |
| Database (SQL) | PostgreSQL 15 (Amazon RDS) | Users (auth schema), matches + player stats (stats schema) |
| Database (NoSQL) | Amazon DynamoDB | Matchmaking tickets, live sessions — key-value with TTL |
| Matchmaking engine | GameLift FlexMatch | Rule-based matchmaking configuration |
| Game server hosting | AWS GameLift Managed EC2 Fleet | Auto-scaling, session management, health checks |
| Infrastructure as Code | AWS CDK (TypeScript) | Defines ECS services, RDS, ALB, GameLift resources |
| Container registry | Amazon ECR | Stores Docker images for all three FastAPI services |

## Project structure

```
tank-battle-royale/
├── CLAUDE.md                          # This file
│
├── unity-project/                     # Unity project root
│   ├── Assets/
│   │   ├── Scripts/
│   │   │   ├── Shared/                # Code used by both client and server
│   │   │   │   ├── TankController.cs  # Tank movement, physics
│   │   │   │   ├── WeaponSystem.cs    # Shooting mechanics
│   │   │   │   ├── HealthSystem.cs    # Damage, elimination
│   │   │   │   ├── GameState.cs       # Match state (waiting, playing, ended)
│   │   │   │   └── NetworkMessages.cs # Custom RPCs and NetworkVariable definitions
│   │   │   ├── Client/               # Client-only code (#if CLIENT or !SERVER)
│   │   │   │   ├── UIManager.cs       # Login, lobby, HUD screens
│   │   │   │   ├── InputHandler.cs    # Read player input, send to server
│   │   │   │   ├── CameraController.cs
│   │   │   │   ├── AuthClient.cs      # HTTP calls: /api/v1/register, /api/v1/login
│   │   │   │   ├── MatchmakingClient.cs # HTTP calls: /api/v1/join, /api/v1/match-status/*
│   │   │   │   └── StatsClient.cs     # HTTP calls: /api/v1/players/*, /api/v1/leaderboard
│   │   │   └── Server/               # Server-only code (#if SERVER)
│   │   │       ├── ServerGameManager.cs   # Game loop: spawn, check winner, report results
│   │   │       ├── GameLiftManager.cs     # GameLift Server SDK integration
│   │   │       ├── ServerNetworkManager.cs # Accept connections, validate player sessions
│   │   │       └── MatchReporter.cs   # HTTP POST to /api/v1/matches when match ends
│   │   ├── Prefabs/
│   │   │   └── Tank.prefab           # Tank with NetworkObject, NetworkTransform, etc.
│   │   └── Scenes/
│   │       ├── MainMenu.unity
│   │       ├── Lobby.unity
│   │       └── BattleArena.unity
│   └── Packages/
│       └── manifest.json             # NGO, Unity Transport, GameLift plugin
│
├── services/                          # Backend microservices (Python + Docker)
│   ├── shared/                        # Shared Python package (installed by all services)
│   │   ├── pyproject.toml             # Package metadata, deps: python-jose, passlib, pydantic
│   │   └── shared/
│   │       ├── __init__.py
│   │       ├── auth.py                # get_current_user (JWT), verify_api_key — defined ONCE
│   │       └── config.py              # Shared settings: JWT_SECRET, JWT_ALGORITHM
│   │
│   ├── auth/                          # Auth Service
│   │   ├── Dockerfile
│   │   ├── requirements.txt           # fastapi, uvicorn, sqlalchemy, psycopg2-binary,
│   │   │                              # passlib[bcrypt], shared @ file:../shared
│   │   ├── app/
│   │   │   ├── main.py                # FastAPI app, CORS, lifespan
│   │   │   ├── config.py              # Settings from env vars (DB_URL, JWT_SECRET, etc.)
│   │   │   ├── models.py              # SQLAlchemy models (User table, auth schema)
│   │   │   ├── schemas.py             # Pydantic request/response schemas
│   │   │   ├── jwt.py                 # JWT creation (login/register issue tokens)
│   │   │   ├── routes.py              # POST /api/v1/register, POST /api/v1/login, GET /api/v1/me
│   │   │   └── database.py            # SQLAlchemy engine + session factory
│   │   └── tests/
│   │       └── test_auth.py
│   │
│   ├── matchmaking/                   # Matchmaking Service
│   │   ├── Dockerfile
│   │   ├── requirements.txt           # fastapi, uvicorn, boto3, shared @ file:../shared
│   │   │                              # boto3 used for both GameLift and DynamoDB
│   │   ├── app/
│   │   │   ├── main.py                # FastAPI app, CORS, lifespan
│   │   │   ├── config.py              # Settings (AWS region, FlexMatch config name, table names)
│   │   │   ├── schemas.py             # Pydantic request/response schemas
│   │   │   ├── routes.py              # POST /api/v1/join, GET /api/v1/match-status/{ticket_id}
│   │   │   ├── gamelift_client.py     # Wrapper around boto3 GameLift calls
│   │   │   └── dynamo_client.py       # Wrapper around boto3 DynamoDB calls (tickets + sessions tables)
│   │   └── tests/
│   │       └── test_matchmaking.py
│   │
│   └── stats/                         # Stats Service
│       ├── Dockerfile
│       ├── requirements.txt           # fastapi, uvicorn, sqlalchemy, psycopg2-binary,
│       │                              # shared @ file:../shared
│       ├── app/
│       │   ├── main.py                # FastAPI app, CORS, lifespan
│       │   ├── config.py              # Settings from env vars (DB_URL, STATS_API_KEY)
│       │   ├── models.py              # SQLAlchemy models (Match, MatchPlayer tables, stats schema)
│       │   ├── schemas.py             # Pydantic request/response schemas
│       │   ├── routes.py              # POST /api/v1/matches, GET /api/v1/players/{id}, GET /api/v1/leaderboard
│       │   └── database.py            # SQLAlchemy engine + session factory
│       └── tests/
│           └── test_stats.py
│
├── aws-infra/                         # AWS CDK app (TypeScript)
│   ├── bin/
│   │   └── app.ts                     # CDK app entry point
│   ├── lib/
│   │   ├── network-stack.ts           # VPC, subnets, security groups
│   │   ├── database-stack.ts          # RDS PostgreSQL + DynamoDB tables
│   │   ├── ecs-stack.ts               # ECS Cluster, 3x Fargate services, ALB, ECR repos
│   │   └── gamelift-stack.ts          # GameLift fleet, FlexMatch config, alias, queue
│   ├── flexmatch/
│   │   └── matchmaking-ruleset.json   # FlexMatch rule set (team size, skill rules)
│   ├── cdk.json
│   ├── tsconfig.json
│   └── package.json
│
├── docker-compose.yml                 # Local development: all 3 services + PostgreSQL + DynamoDB Local
│
└── docs/
    ├── architecture.md
    └── setup-guide.md
```

## What Claude Code can help with

### YES — generate these files

- **All C# scripts** in `Assets/Scripts/` — MonoBehaviours, NetworkBehaviours, RPCs, NetworkVariables, GameLift server SDK integration, HTTP clients for all three services.
- **FastAPI services** in Python — all three services (auth, matchmaking, stats) with routes, models, auth logic, DB setup, GameLift wrapper, DynamoDB client.
- **Dockerfiles** for all three services — multi-stage builds, slim images.
- **CDK stacks** in TypeScript — VPC, RDS, DynamoDB, ECS cluster, Fargate task definitions, ALB, ECR, GameLift fleet, FlexMatch configuration.
- **FlexMatch rule sets** — JSON matchmaking configuration.
- **docker-compose.yml** for local development — all services + PostgreSQL + DynamoDB Local.
- **Tests** for all FastAPI services.
- **Documentation and setup guides**.

### NO — cannot do these (manual Unity Editor work)

- Create or modify Unity scenes (`.unity` files are binary/YAML — must use Unity Editor).
- Create prefabs visually (write the component code; attaching it is done in Editor).
- Import assets, configure project settings, set up build profiles.
- Build the Unity project (requires Unity Editor + Build pipeline).
- Test gameplay (requires running the game).

### Workflow suggestion

When generating Unity scripts, always include clear comments at the top of each file explaining:

1. What GameObject this script should be attached to.
2. What other components are required on that GameObject (e.g., NetworkObject, Rigidbody).
3. What fields need to be configured in the Unity Inspector.

Example:

```csharp
/// <summary>
/// Attach to: Tank prefab root GameObject
/// Required components: NetworkObject, NetworkTransform, Rigidbody, BoxCollider
/// Inspector config: Set moveSpeed=10, rotateSpeed=120, maxHealth=100
/// </summary>
```

## Game design (minimal viable version)

- **Players per match**: 4 (keep small for the course project)
- **Win condition**: Last tank standing
- **Core mechanics**: Move (WASD), rotate turret (mouse), shoot (click). Projectiles deal damage. Tanks have health bars.
- **Map**: Simple flat arena with some obstacles (walls/boxes). No shrinking zone for MVP — add later if time permits.
- **Session duration**: ~3-5 minutes per match.

## Coding conventions

- **C# (Unity)**: PascalCase for public methods/properties, camelCase for private fields with `_` prefix. Use `[SerializeField]` for Inspector-exposed private fields. Prefer `TryGetComponent` over `GetComponent`. Always null-check network references.
- **Python (FastAPI services)**: snake_case for variables/functions, PascalCase for classes. Type hints everywhere. Pydantic models for all request/response schemas. Use `async def` for route handlers. Use dependency injection (`Depends()`) for DB sessions and auth. Structure: config → models → schemas → routes → main.
- **TypeScript (CDK)**: camelCase for variables/functions, PascalCase for classes and construct names. Use `aws-cdk-lib` v2 (single package). Define each stack in its own file under `lib/`. Use interfaces for stack props. Prefer L2 constructs over L1 (Cfn*) unless no L2 exists (e.g., some GameLift resources). Always tag resources with `project: tank-battle-royale` and `environment: dev`.
- **Docker**: Multi-stage builds. Use `python:3.12-slim` as base. Non-root user. Copy requirements first for layer caching. Each service's Dockerfile must also COPY the `shared/` package and install it (e.g., `COPY services/shared /app/shared` then `pip install /app/shared`).
- **Comments**: Write generous comments. This is a learning project — explain WHY, not just what.
- **Preprocessor directives**: Use `#if SERVER` / `#if CLIENT` (not `!SERVER`) for clarity when code is exclusive to one build target.

## Key Unity + NGO concepts to apply

- `NetworkBehaviour` instead of `MonoBehaviour` for any networked script.
- `NetworkVariable<T>` for state that auto-syncs (health, score, alive status).
- `[ServerRpc]` for client → server calls (e.g., "I want to shoot").
- `[ClientRpc]` for server → client calls (e.g., "explosion VFX at position X").
- `NetworkObject` component required on any prefab that gets spawned over the network.
- `NetworkTransform` for automatic position/rotation sync.
- `IsServer`, `IsClient`, `IsOwner` checks to gate logic appropriately.

## API routing and auth protection

### How the ALB routes requests

The client sends ALL requests to a single URL (the ALB's DNS name). The ALB inspects the path and forwards to the correct ECS target group:

```
Client request                              ALB routes to
─────────────────                           ───────────────
POST /api/v1/register                   →   Auth Service
POST /api/v1/login                      →   Auth Service
GET  /api/v1/me                         →   Auth Service
POST /api/v1/join                       →   Matchmaking Service
GET  /api/v1/match-status/{ticket_id}   →   Matchmaking Service
POST /api/v1/matches                    →   Stats Service
GET  /api/v1/players/{user_id}          →   Stats Service
GET  /api/v1/players/{user_id}/history  →   Stats Service
GET  /api/v1/leaderboard               →   Stats Service
```

The Unity client configures one base URL (e.g., `http://tank-battle-alb-123.us-east-1.elb.amazonaws.com`) and appends paths. It never needs to know which service handles what.

### How protected endpoints work

Auth logic is defined **once** in the shared Python package and applied at the **router level** — not repeated per endpoint, not repeated per service.

**Step 1: Shared package** (`services/shared/shared/auth.py`) — single source of truth:

```python
# services/shared/shared/auth.py — ONE file, all services import from here

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import os

security = HTTPBearer()
JWT_SECRET = os.getenv("JWT_SECRET")

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    """Validates JWT. Returns user claims or raises 401.
    Used as a FastAPI dependency on protected routers."""
    try:
        return jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

async def verify_api_key(api_key: str = Depends(HTTPBearer(scheme_name="ApiKey"))) -> str:
    """Validates X-API-Key header for service-to-service calls (game server → stats)."""
    if api_key.credentials != os.getenv("STATS_API_KEY"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid API key")
    return api_key.credentials
```

**Step 2: Router-level dependency** — declare once, protects all routes on that router:

```python
# services/matchmaking/app/routes.py
from fastapi import APIRouter, Depends
from shared.auth import get_current_user   # imported from shared package

# Every route on this router requires a valid JWT — ONE line
router = APIRouter(prefix="/api/v1", dependencies=[Depends(get_current_user)])

@router.post("/join")
async def join(user: dict = Depends(get_current_user)):
    player_id = user["sub"]
    ...

@router.get("/match-status/{ticket_id}")
async def match_status(ticket_id: str, user: dict = Depends(get_current_user)):
    ...

# Add 50 more endpoints here — all protected, zero extra auth code
```

```python
# services/stats/app/routes.py
from fastapi import APIRouter, Depends
from shared.auth import get_current_user, verify_api_key

# Player-facing routes — JWT protected
player_router = APIRouter(prefix="/api/v1", dependencies=[Depends(get_current_user)])

@player_router.get("/players/{user_id}")
async def get_player(user_id: str):
    ...

@player_router.get("/leaderboard")
async def leaderboard():
    ...

# Internal routes — API key protected (game server only)
internal_router = APIRouter(prefix="/api/v1", dependencies=[Depends(verify_api_key)])

@internal_router.post("/matches")
async def record_match(payload: MatchResult):
    ...
```

**Scaling summary**: Add a new service? `pip install shared`, import `get_current_user`, put it on your router. Add new endpoints? They're already protected by the router dependency. Change JWT logic (e.g., switch to RS256, add claims)? Change one file, rebuild all Docker images.

**Auth summary by endpoint:**

| Endpoint | Protection | Mechanism |
|----------|-----------|-----------|
| `/api/v1/register` | None | Public router (no dependency) |
| `/api/v1/login` | None | Public router (no dependency) |
| `/api/v1/me` | JWT | `get_current_user` on auth's protected router |
| `/api/v1/join` | JWT | `get_current_user` on matchmaking router |
| `/api/v1/match-status/*` | JWT | `get_current_user` on matchmaking router |
| `/api/v1/matches` (POST) | API key | `verify_api_key` on stats internal router |
| `/api/v1/players/*` | JWT | `get_current_user` on stats player router |
| `/api/v1/leaderboard` | JWT | `get_current_user` on stats player router |

## Service details

### Auth Service

**Responsibility**: User identity only. Register, login, JWT issuance.

#### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/register` | None | Create account (username, email, password) → returns JWT |
| POST | `/api/v1/login` | None | Verify credentials → returns JWT |
| GET | `/api/v1/me` | JWT required | Returns current user profile |

#### JWT structure

```json
{
  "sub": "user-uuid",
  "username": "player1",
  "exp": 1234567890,
  "iat": 1234567890
}
```

All services install the shared package (`shared @ file:../shared`), which reads `JWT_SECRET` from the environment. Auth service creates tokens; matchmaking and stats services validate them via the shared `get_current_user` dependency. No inter-service calls needed for auth.

#### Database: PostgreSQL (auth schema)

```sql
CREATE SCHEMA auth;

CREATE TABLE auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

---

### Matchmaking Service

**Responsibility**: Matchmaking only. Bridges client requests to GameLift FlexMatch. Stores ephemeral ticket/session data in DynamoDB.

#### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/join` | JWT required | Start matchmaking → returns ticket_id |
| GET | `/api/v1/match-status/{ticket_id}` | JWT required | Poll match status → returns status + connection info when ready |

#### GameLift interaction flow

```python
# POST /api/v1/join
# 1. Validate JWT from Authorization header (via Depends(get_current_user))
# 2. Extract player_id (sub claim) from token
# 3. Call boto3 gamelift.start_matchmaking(
#        ConfigurationName="tank-battle-4v4",
#        Players=[{"PlayerId": player_id, "PlayerAttributes": {...}}]
#    )
# 4. Store ticket in DynamoDB (MatchmakingTickets table) with player_id, status, TTL
# 5. Return {"ticket_id": response["MatchmakingTicket"]["TicketId"]}

# GET /api/v1/match-status/{ticket_id}
# 1. Validate JWT (via Depends(get_current_user))
# 2. Check DynamoDB first (fast cache hit if already completed)
# 3. If not completed, call boto3 gamelift.describe_matchmaking(TicketIds=[ticket_id])
# 4. Update DynamoDB with latest status
# 5. Check ticket status:
#    - "SEARCHING" / "PLACING" → return {"status": "searching"}
#    - "COMPLETED" → extract GameSessionConnectionInfo,
#      store session in DynamoDB (GameSessions table)
#      → return {"status": "ready", "ip": ..., "port": ..., "player_session_id": ...}
#    - "TIMED_OUT" / "CANCELLED" / "FAILED" → return {"status": "failed"}
```

#### Database: DynamoDB

```
MatchmakingTickets
├── PK: ticket_id (String)
├── player_id (String)
├── status (String): "SEARCHING" | "PLACING" | "COMPLETED" | "FAILED" | "TIMED_OUT" | "CANCELLED"
├── game_session_ip (String, optional)       # populated when COMPLETED
├── game_session_port (Number, optional)     # populated when COMPLETED
├── player_session_id (String, optional)     # populated when COMPLETED
├── created_at (String, ISO 8601)
└── expires_at (Number, TTL)                 # auto-delete after 1 hour

GameSessions
├── PK: session_id (String)                  # GameLift game session ID
├── ip (String)
├── port (Number)
├── player_ids (StringSet)                   # set of player UUIDs in this session
├── status (String): "ACTIVE" | "ENDED"
├── created_at (String, ISO 8601)
└── expires_at (Number, TTL)                 # auto-delete after 24 hours
```

**Why DynamoDB here (not PostgreSQL):**
- Matchmaking tickets are ephemeral — created, polled a few times, then irrelevant. TTL handles cleanup automatically.
- Game sessions are looked up by ID only — no joins, no complex queries. Pure key-value.
- Polling `/mm/status` can be frequent (every 2-3s per player). DynamoDB handles this throughput without connection pool pressure on RDS.
- PostgreSQL stays clean for durable, relational data (users, stats, history).

---

### Stats Service

**Responsibility**: Game data only. Receives match results, stores stats, serves leaderboards and player profiles.

#### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/matches` | Internal (API key) | Record match results — called by game server when match ends |
| GET | `/api/v1/players/{user_id}` | JWT required | Player profile: total matches, wins, K/D ratio, avg placement |
| GET | `/api/v1/players/{user_id}/history` | JWT required | Match history for a player (paginated) |
| GET | `/api/v1/leaderboard` | JWT required | Top players by wins, K/D, or matches played |

**Note on auth for POST /api/v1/matches**: The game server (running on GameLift) calls this endpoint, not a player client. Use a shared API key (via `X-API-Key` header) rather than a player JWT. This prevents players from spoofing match results.

#### Database: PostgreSQL (stats schema)

```sql
CREATE SCHEMA stats;

CREATE TABLE stats.matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gamelift_session_id VARCHAR(255) UNIQUE NOT NULL,
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP NOT NULL,
    duration_seconds INT NOT NULL,
    winner_id UUID NOT NULL,              -- references auth.users.id (cross-schema)
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE stats.match_players (
    match_id UUID REFERENCES stats.matches(id),
    user_id UUID NOT NULL,                -- references auth.users.id (cross-schema)
    kills INT DEFAULT 0,
    deaths INT DEFAULT 0,
    damage_dealt INT DEFAULT 0,
    survival_time_seconds INT DEFAULT 0,
    placement INT NOT NULL,               -- 1st, 2nd, 3rd, 4th
    PRIMARY KEY (match_id, user_id)
);

-- Useful indexes for leaderboard queries
CREATE INDEX idx_match_players_user ON stats.match_players(user_id);
CREATE INDEX idx_matches_winner ON stats.matches(winner_id);
CREATE INDEX idx_matches_ended ON stats.matches(ended_at DESC);
```

#### Match result payload (from game server)

```json
{
  "gamelift_session_id": "arn:aws:gamelift:...",
  "started_at": "2026-03-14T10:00:00Z",
  "ended_at": "2026-03-14T10:04:32Z",
  "winner_id": "uuid-of-winner",
  "players": [
    {
      "user_id": "uuid-1",
      "kills": 3,
      "deaths": 0,
      "damage_dealt": 450,
      "survival_time_seconds": 272,
      "placement": 1
    },
    {
      "user_id": "uuid-2",
      "kills": 1,
      "deaths": 1,
      "damage_dealt": 200,
      "survival_time_seconds": 180,
      "placement": 2
    }
  ]
}
```

## Key AWS integration points

### GameLift Server SDK (in Unity headless server)

```csharp
// Lifecycle the server must implement:
// 1. InitSDK() — on server start
// 2. ProcessReady() — tell GameLift "I'm ready to host"
// 3. OnStartGameSession callback — GameLift assigns a match to this server
// 4. ActivateGameSession() — confirm the session is live
// 5. AcceptPlayerSession(playerSessionId) — validate each connecting player
// 6. RemovePlayerSession(playerSessionId) — when player disconnects
// 7. ProcessEnding() — when match ends, tell GameLift to recycle
```

### CDK infrastructure overview

```typescript
// network-stack.ts → VPC with public + private subnets, NAT gateway
//
// database-stack.ts:
//   - RDS PostgreSQL in private subnet (two schemas: auth, stats)
//   - DynamoDB: MatchmakingTickets table (PK: ticket_id, TTL: expires_at)
//   - DynamoDB: GameSessions table (PK: session_id, TTL: expires_at)
//
// ecs-stack.ts:
//   - ECS Cluster
//   - ECR repositories (one per service: auth, matchmaking, stats)
//   - 3x Fargate Task Definitions with env vars:
//     - Auth: DB_URL (auth schema), JWT_SECRET
//     - Matchmaking: JWT_SECRET, AWS_REGION, FLEXMATCH_CONFIG_NAME, table names
//     - Stats: DB_URL (stats schema), JWT_SECRET, STATS_API_KEY
//   - 3x Fargate Services
//   - ALB (single entry point for all HTTP traffic):
//     - Path-based routing rules:
//       /api/v1/register, /api/v1/login, /api/v1/me       → Auth target group
//       /api/v1/join, /api/v1/match-status/*               → Matchmaking target group
//       /api/v1/matches, /api/v1/players/*, /api/v1/leaderboard → Stats target group
//     - Health check paths: /health on each service
//     - Default action: 404 (no catch-all)
//   - IAM role for matchmaking service: gamelift:StartMatchmaking,
//     gamelift:DescribeMatchmaking, dynamodb:PutItem, dynamodb:GetItem,
//     dynamodb:UpdateItem, dynamodb:Query
//   - IAM role for stats service: minimal (RDS only, no AWS API calls)
//
// gamelift-stack.ts:
//   - GameLift Build (uploaded Unity headless server)
//   - GameLift Fleet (EC2 instances running the server)
//   - FlexMatch MatchmakingRuleSet
//   - FlexMatch MatchmakingConfiguration
//   - GameSession Queue
```

## Local development

Use `docker-compose.yml` to run locally:

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: tankbattle
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: devpassword
    ports:
      - "5432:5432"
    volumes:
      - ./scripts/init-schemas.sql:/docker-entrypoint-initdb.d/init.sql

  dynamodb-local:
    image: amazon/dynamodb-local:latest
    ports:
      - "8000:8000"
    command: ["-jar", "DynamoDBLocal.jar", "-sharedDb"]

  auth:
    build: ./services/auth
    ports:
      - "8001:8000"
    environment:
      DATABASE_URL: postgresql://dev:devpassword@postgres:5432/tankbattle
      DATABASE_SCHEMA: auth
      JWT_SECRET: local-dev-secret
    depends_on:
      - postgres

  matchmaking:
    build: ./services/matchmaking
    ports:
      - "8002:8000"
    environment:
      JWT_SECRET: local-dev-secret
      AWS_REGION: us-east-1
      FLEXMATCH_CONFIG_NAME: tank-battle-4v4
      DYNAMODB_ENDPOINT: http://dynamodb-local:8000
      DYNAMODB_TICKETS_TABLE: MatchmakingTickets
      DYNAMODB_SESSIONS_TABLE: GameSessions
      MOCK_GAMELIFT: "true"
    depends_on:
      - dynamodb-local

  stats:
    build: ./services/stats
    ports:
      - "8003:8000"
    environment:
      DATABASE_URL: postgresql://dev:devpassword@postgres:5432/tankbattle
      DATABASE_SCHEMA: stats
      JWT_SECRET: local-dev-secret
      STATS_API_KEY: local-dev-api-key
    depends_on:
      - postgres
```

**init-schemas.sql** (mounted into PostgreSQL container):
```sql
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS stats;
```

For local matchmaking testing, the matchmaking service can run in a "mock mode" that returns fake connection info without calling GameLift. Set `MOCK_GAMELIFT=true` as an env var.

## Getting started

1. **Auth service** → Set up `services/auth` with FastAPI, PostgreSQL, JWT. Test locally with docker-compose (`POST /api/v1/register`, `POST /api/v1/login`, `GET /api/v1/me`). This is independent of everything else.
2. **Matchmaking service** → Set up `services/matchmaking` with mock GameLift mode + DynamoDB Local. Test: register → login → `POST /api/v1/join` → poll `/api/v1/match-status/{id}`.
3. **Stats service** → Set up `services/stats`. Test: `POST /api/v1/matches` with sample payload → `GET /api/v1/players/{id}` → `GET /api/v1/leaderboard`.
4. **Unity basics** → Create the Unity project with a tank that moves and shoots in singleplayer.
5. **Unity networking** → Add NGO. Make tank movement sync between host and client locally.
6. **Unity HTTP clients** → Add `AuthClient.cs`, `MatchmakingClient.cs`, `StatsClient.cs` to call the FastAPI services.
7. **CDK infrastructure** → `cd aws-infra && npx cdk init app --language typescript`, then build stacks. Deploy ECS services, RDS, DynamoDB, ALB. Test with `cdk synth` and `cdk deploy`.
8. **GameLift integration** → Add `GameLiftManager.cs` and `MatchReporter.cs` to the server. Upload headless build to GameLift. Configure FlexMatch. Remove mock mode from matchmaking service.
9. **End-to-end test** → Register → Login → Find match → Play → Game ends → Stats recorded → View leaderboard.

## References

- [Unity Netcode for GameObjects docs](https://docs-multiplayer.unity3d.com/netcode/current/about/)
- [GameLift Plugin for Unity (SDK 5.x)](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/unity-plug-in.html)
- [GameLift Server SDK integration guide](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/integration-engines-unity-using.html)
- [FlexMatch developer guide](https://docs.aws.amazon.com/gamelift/latest/flexmatchguide/match-intro.html)
- [FlexMatch standalone matchmaking roadmap](https://docs.aws.amazon.com/gameliftservers/latest/flexmatchguide/match-tasks-safm.html)
- [AWS sample: amazon-gamelift-unity](https://github.com/aws-samples/amazon-gamelift-unity)
- [Tutorial: Building a Real-Time Multiplayer Game with Unity + GameLift (Bruffa)](https://betterprogramming.pub/building-a-real-time-multiplayer-game-with-unity3d-and-amazon-gamelift-228f706cfbec)
- [Code Monkey NGO course](https://unitycodemonkey.com/kitchenchaosmultiplayercourse.php)
- [Boss Room sample (production-level NGO)](https://github.com/Unity-Technologies/com.unity.multiplayer.samples.coop)
- [FastAPI docs](https://fastapi.tiangolo.com/)
- [SQLAlchemy async with FastAPI](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)