## Yarmouth Chamber Music Festival Website

Static Astro site with Tina Cloud inline editing for the Yarmouth Chamber Music Festival.

### Prerequisites
- Node.js 20+
- npm 9+
- Tina Cloud account (free tier works)

### Getting Started
1. Install dependencies
   ```bash
   npm install
   ```
2. Initialize Tina (generates GraphQL client)
   ```bash
   npx @tinacms/cli init
   ```
3. Connect to Tina Cloud  
   - Create a project at [tina.io](https://app.tina.io)  
   - Set `TINA_CLIENT_ID` and `TINA_TOKEN` in `.env`
4. Run Tina + Astro dev server
   ```bash
   npm run tina:dev
   ```

### Content Structure
- `src/content/pages/home.md` – hero copy, highlights, CTA
- `src/content/events/*.md` – festival events (date, time, location, price, description, program)

### TinaCMS Notes
- `tina/config.ts` defines the schema for pages and events.
- The home page tries to use Tina data when inline editing is active and falls back to Astro content otherwise.
- Run `npm run tina:build` before deploys to bundle the Tina admin (`public/admin`).

### Deployment (GitHub Pages)
- GitHub Actions workflow: `.github/workflows/deploy.yml`
- Configure the repo’s Pages settings to deploy from “GitHub Actions.”
- On push to `main`, the workflow installs dependencies, runs `npm run tina:build`, and publishes `dist/` to GitHub Pages.
