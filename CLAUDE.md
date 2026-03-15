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