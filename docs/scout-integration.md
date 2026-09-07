# Scout Integration & Public Enrichment Architecture

## Overview
This document outlines the architectural boundaries, repository structure, and operational protocols for **Scout**, the public OSINT and profile enrichment engine embedded within GrowthForge.

## Key Architectural Principles

1. **Internally Owned Copy**:
   - The `/scout` directory contains a self-contained, internally owned copy of the Scout OSINT scraping engine.
   - Original upstream source: `kiryano/Scout` (MIT License).
   - GrowthForge does **not** depend on the upstream repository at runtime.
   - Future updates to Scout will be manually reviewed, audited, and selectively imported without breaking the internal GrowthForge contract.

2. **Runtime Location & Execution Environment**:
   - Location: `/scout` (at the root of the repository).
   - Language/Runtime: Python 3.10+.
   - Dependencies are tracked independently in `/scout/requirements.txt` and are isolated from the frontend Node.js / TypeScript runtime.

3. **Strict Interface Boundary (`ScoutAdapter`)**:
   - GrowthForge interacts with Scout **exclusively** through the TypeScript boundary interface:
     `app/services/scout/scoutAdapter.ts`
   - Frontend and backend services never invoke Scout's internal scraper modules directly.
   - Scout scraper modules (`app/scrapers/*`) are kept strictly in Python and are never rewritten to TypeScript.

4. **Directory Structure**:
   ```
   /scout/
   ├── .env.example
   ├── .gitignore
   ├── LICENSE
   ├── README.md
   ├── proxies.example.txt
   ├── requirements.txt
   ├── scout.py
   └── app/
       ├── __init__.py
       └── scrapers/
           ├── __init__.py
           ├── enrichment.py
           ├── github.py
           ├── instagram.py
           ├── linkedin.py
           ├── linktree.py
           ├── pinterest.py
           ├── stealth.py
           ├── tiktok.py
           ├── twitch.py
           ├── utils.py
           └── youtube.py
   ```

5. **Security & Licensing**:
   - Scout is licensed under the MIT License (`/scout/LICENSE`). Original author attribution is preserved.
   - No secrets, real credentials, live proxies, or cookies are stored in the repository.
   - Example configuration files (`.env.example`, `proxies.example.txt`) provide non-sensitive templates only.
