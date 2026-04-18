# Tank Battle Royale - Final Project

This repository contains the full implementation of "Tank Battle Royale," a multiplayer game featuring its own Unity client, a Python microservices backend, and comprehensive Infrastructure as Code (IaC) deployed on AWS.

This documentation is designed both to guide **development team members** and to facilitate evaluation and review by the **professor/evaluator**.

---

## 🎯 Project Objective

To develop a competitive multiplayer video game with a scalable architecture, clearly separating responsibilities between the frontend client (the game itself) and the backend (matchmaking and identity). Furthermore, it implements modern DevOps practices by utilizing containerization and cloud infrastructure deployed on AWS.

## 🏗️ For the Evaluator: Technologies & Architecture

The project applies industry standards and software development best practices:

- **Frontend (Game Client)**:
  - Developed in **Unity**.
  - Utilizes the official **Unity Netcode for GameObjects (NGO)** framework for an authoritative *Host/Client* architecture and real-time network persistence.
- **Backend (API Microservices)**:
  - Built with **Python 3** using **FastAPI** for high performance and concurrency.
  - Uses **Pydantic** for strict typing and data schema validation.
  - Composed of two main microservices:
    - **`Auth`**: Secure authentication service based on JWT (`localhost:8001`).
    - **`Matchmaking`**: Concurrent management of wait queues and logical session assignments (`localhost:8002`).
- **Infrastructure as Code (AWS IaC)**:
  - Programmatically defined using **AWS CDK (TypeScript)**.
  - Deploys instances on Amazon ECS, Amazon DynamoDB tables, Amazon ECR registries, and includes design integrations for **AWS GameLift**.
- **DevOps & Integration**:
  - Full containerization of all microservices using **Docker and Docker Compose**.
  - **CI/CD via GitHub Actions**: Automated pipelines that analyze the Python environment using Flake8 and Black to prevent code smells prior to deployment.

---

## 🛠️ For the Development Team: Structure

The monorepo encompasses the three main segments of our technology stack, located in their respective folders:

1. 🎮 **`Unity_Project/Panzer Warfare/`**: Core game project. The main functional loop goes through three scenes: `Login` → `Lobby` → `Game`.
2. ⚙️ **`services/`**: The microservices directory, containing subdirectories for `auth`, `matchmaking`, and an essential `shared` module with reusable Python base libraries.
3. ☁️ **`aws-infra/`**: Infrastructure validation scripts and CloudFormation definitions generated via CDK class interfaces.

### Current Flow Status (Recent Merges)
For traceability in our development lifecycle, the Git branches responsible for our current structure include the following milestones:
- **Offline Flow & Mock Environments (`feat/mock-gamelift`)**: Integrated a mock system to emulate AWS locally. This enables iterative, fully local testing of the Lobby-to-Server validation flow without relying on the cloud.
- **Local P2P Synchronization Integration (`feat/multiplayer-local-integration`)**: Established the Unity logic foundations to instantiate players and handle visual component movement from client to client without a dedicated server, using `127.0.0.1`.
- **Repository Standardization (`feat/add-linting-config` & docker)**: Introduced `curl` in Dockerfiles for robust network Health Checks between services, and integrated comprehensive linters into automated PR pipelines.

---

## 🚀 Local Setup & Evaluation Guide (Quick Start)

To properly evaluate this project in a local environment, please follow this integration sequence:

### 1. Start the Backend Microservices
Ensure **Docker Desktop** (or the Docker daemon) is running. Open your terminal at the root of the project repository and spin up the services:

```bash
# This command builds and starts the Auth and Matchmaking services on ports 8001 and 8002
docker-compose up --build
```
> *Note: When using the local configuration, the ecosystem routes web traffic to a mock matchmaking logic, preventing any incurred costs on Amazon Web Services.*

### 2. Test Unity Connectivity & Multiplayer
1. Open **Unity Editor** and load the project folder found at `Unity_Project/Panzer Warfare/`.
2. **Backend Connectivity Test**: Run the `Login` scene. If the backend is running, the system will successfully authenticate with Docker and dynamically transition to the `Lobby`.
3. **P2P Network Multiplayer Test (Local)**: You will need to emulate two clients to validate movement persistence. We recommend using an environment cloner in Unity such as *ParrelSync*.
   - **Editor 1**: While in the final `Game` scene, press the **HOST** button in the graphical interface. (Acts as server + client on port 7777).
   - **Editor Clone/2**: While in the `Game` environment, press the **JOIN** button. You will observe instantaneous tank synchronization via TCP sockets over your local subnet.

---

## 📚 Additional Documentation

Please refer to the repository's documentary annexes to delve into specific architectural flows:
- [📖 Architecture Plan (`docs/PLAN.md`)](docs/PLAN.md) - (Highly recommended for the Professor) Contains the granular AWS infrastructure design, API contract diagrams, DB schemas, as well as the full technical specifications of the game's lifecycle.
- [📝 Developer Guideline (`CLAUDE.md`)](CLAUDE.md) - Code conventions that the team must adopt when creating a PR or adding new features. Do not ignore this file in future Pull Requests.
