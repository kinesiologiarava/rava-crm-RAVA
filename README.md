# CRM Kinesiología Rava 🏥

## Deploy en 15 minutos

---

### PASO 1 — Crear tablas en Supabase

1. Ir a **supabase.com** → tu proyecto → **SQL Editor**
2. Copiar y pegar el contenido de `supabase-schema.sql`
3. Click en **Run** (▶)

Esto crea las 4 tablas y carga los datos iniciales de febrero/marzo.

---

### PASO 2 — Configurar credenciales

1. En Supabase: **Settings → API**
2. Copiar **Project URL** y **anon/public key**
3. Editar `.env.local`:

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### PASO 3 — Instalar y probar local

```bash
npm install
npm run dev
```

Abrir **http://localhost:5173** — el CRM debería cargar con tus datos de Supabase.

---

### PASO 4 — Deploy en Netlify

**Opción A — Drag & Drop (más fácil):**
```bash
npm run build
```
Subir la carpeta `/dist` a netlify.com → "Deploy manually"

**Opción B — Conectar con GitHub (recomendado):**
1. Subir el proyecto a GitHub
2. En Netlify: "Import from Git" → seleccionar el repo
3. Build command: `npm run build`
4. Publish directory: `dist`
5. En **Site settings → Environment variables** agregar:
   - `VITE_SUPABASE_URL` = tu URL
   - `VITE_SUPABASE_ANON_KEY` = tu key

---

### PASO 5 — Deploy en Vercel (alternativa)

```bash
npm install -g vercel
vercel
```
Seguir las instrucciones. Agregar las variables de entorno en el dashboard de Vercel.

---

### PASO 6 — Instalar como app en el celular (PWA)

**iPhone (Safari):**
1. Abrir la URL en Safari
2. Compartir → "Añadir a pantalla de inicio"

**Android (Chrome):**
1. Abrir la URL en Chrome
2. Menú → "Instalar app" o "Añadir a pantalla de inicio"

La app se abre en pantalla completa sin barra del browser, como una app nativa.

---

## Estructura del proyecto

```
rava-crm/
├── src/
│   ├── main.jsx          # Entry point React
│   ├── App.jsx           # Wrapper con carga Supabase
│   ├── RavaCRM.jsx       # CRM completo (copiarlo del archivo generado)
│   └── supabase.js       # Cliente y queries
├── public/
│   ├── manifest.json     # Config PWA
│   ├── sw.js             # Service Worker (offline)
│   └── icon.svg          # Ícono app
├── supabase-schema.sql   # Script SQL para crear tablas
├── .env.local            # Credenciales (NO subir a GitHub)
├── vite.config.js
└── package.json
```

---

## ⚠️ Importante

- **No subir `.env.local` a GitHub.** Está en `.gitignore` automáticamente.
- Las variables de entorno en Netlify/Vercel se configuran en el panel web.
- Sin Supabase configurado, el CRM funciona con datos locales (se pierden al recargar).
