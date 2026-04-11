# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Tank Battle Royale

## Project spec
Read `docs/PLAN.md` for full architecture, service contracts, and design decisions.

## Build & run (local)
docker-compose up                    # all services + DBs
docker-compose up auth matchmaking   # just backend services

## Services
- Auth: services/auth/ (FastAPI, port 8001)
- Matchmaking: services/matchmaking/ (FastAPI, port 8002)
- Shared package: services/shared/

## CDK
cd aws-infra && npx cdk synth

## Conventions
- Python: snake_case, type hints, Pydantic schemas
- C#: PascalCase public, _camelCase private
- See docs/PLAN.md for full conventions

---

## Unity Project (`Unity_Project/Panzer Warfare/`)

### Scene flow
```
Login.unity → (auth success) → Lobby.unity → (match found) → Game.unity
```

### Key scripts
- **BackendClient.cs** — HTTP singleton (DontDestroyOnLoad on its own dedicated GameObject). Holds `AuthToken`. Methods: `EnviarJson(url, json, callback)` POST, `EnviarGetJson(url, callback)` GET, both with `Authorization: Bearer` header.
- **Login.cs** — Calls BackendClient, parses `{"token":"..."}`, stores in `BackendClient.AuthToken`, loads Lobby scene.
- **LobbyManager.cs** — POST `/api/v1/join` → polls `/api/v1/match-status/{id}` every 2s → on "ready" stores IP/port/session in `GameSessionInfo`, loads Game scene.
- **GameSessionInfo.cs** — DontDestroyOnLoad singleton: `ServerIp`, `ServerPort`, `PlayerSessionId`.
- **GameConnector.cs** — In Game scene. HOST button calls `StartHost()` on `127.0.0.1:7777`; JOIN button calls `StartClient()` using `GameSessionInfo` IP:port.
- **NetworkPlayerSpawner.cs** — Attached to NetworkManager GO. Server-only: spawns `TankPlayer` prefab for each connecting client via `SpawnAsPlayerObject`.
- **TankController.cs** — WASD movement via `UnityEngine.InputSystem`. Uses `GetComponent<NetworkObject>()` to detect ownership; guards all input/camera logic with `IsLocalPlayer` (`_netObj == null || _netObj.IsOwner`). Works in both solo and networked modes.
- **TankNetworkSync.cs** — `NetworkBehaviour` that syncs position/rotation using `NetworkVariable<Vector3/Quaternion>` with `WritePermission.Owner`. Owner writes each frame; non-owners lerp. Replaces `ClientNetworkTransform` (which didn't work reliably in NGO 2.x).
- **ClientNetworkTransform.cs** — Kept in project but NOT used on prefabs. Do not add this to player objects.
- **Server/GameLiftServerManager.cs** — Skeleton only (GameLift SDK not yet integrated).

### TankPlayer prefab (`Assets/Prefabs/Network/TankPlayer.prefab`)
Components: `BoxCollider`, `Rigidbody` (freeze Y pos, freeze X/Z rot), `TankController`, `NetworkObject`, `TankNetworkSync`.
- **No NetworkRigidbody** — it was removed because it forced `isKinematic=true` on the owner, breaking movement.
- **No ClientNetworkTransform** — replaced by TankNetworkSync.

### Local multiplayer architecture (Host/Client)
In local development there is no dedicated server. One Unity Editor instance acts as **Host** (server + client), the other as a pure **Client**:
- Window 1: Play → **HOST** → `NetworkManager.StartHost()` on port 7777
- Window 2 (ParrelSync clone): Play → **JOIN** → `NetworkManager.StartClient()` connecting to `127.0.0.1:7777`

Each player owns their own tank (`IsOwner=true`). `TankNetworkSync` lets the owner drive position freely via Rigidbody; all other peers receive the position through `NetworkVariable` replication and interpolate.

In **production (GameLift)**, the Host is replaced by a headless dedicated server build (`StartServer()`). The matchmaking service returns the real GameLift IP:port; clients connect with the `player_session_id` for `AcceptPlayerSession` validation. The movement code is unchanged.

### Input System
Uses the **new** Unity Input System (`UnityEngine.InputSystem`). Do NOT use legacy `UnityEngine.Input`. EventSystems in all scenes use `InputSystemUIInputModule`, not `StandaloneInputModule`.