# LinkVault

**Asistente personal de enlaces por WhatsApp.** Encuentras algo interesante → lo compartes por WhatsApp al número
de LinkVault → aparece en tu dashboard clasificado, con vista previa y un plazo de revisión → lo marcas como visto,
lo guardas en favoritos o lo descartas.

- Integración **oficial** con WhatsApp Business Platform (Cloud API + webhooks firmados).
- Base de datos persistente en **Supabase PostgreSQL** con **Row Level Security**.
- Dashboard **React + TypeScript + Vite + Tailwind**, en español, claro/oscuro, adaptable a móvil.
- Actualización **en tiempo real** (Supabase Realtime) con respaldo periódico.
- Clasificación automática por **reglas** (sin IA) y, opcionalmente, con **IA** (Anthropic) para resúmenes y etiquetas.
- **Archivado lógico** automático a los 7 días (configurable) con protección de favoritos, seguimientos y postulaciones activas.

---

## Índice

1. [Arquitectura](#arquitectura)
2. [Funcionalidades](#funcionalidades)
3. [Estructura del repositorio](#estructura-del-repositorio)
4. [Instalación paso a paso](#instalación-paso-a-paso)
5. [Despliegue (Vercel)](#despliegue-en-vercel)
6. [Conectar WhatsApp](#conectar-whatsapp)
7. [Seguridad](#seguridad)
8. [Pruebas y CI](#pruebas-y-ci)
9. [Costes y límites](#costes-y-límites)
10. [Estado actual y pendientes](#estado-actual-y-pendientes)

---

## Arquitectura

```
┌──────────────┐  compartir   ┌───────────────────────┐  webhook firmado  ┌──────────────────────────┐
│ WhatsApp del │ ───────────▶ │ Número de LinkVault    │ ────────────────▶ │ Edge Function            │
│ usuario      │              │ (WhatsApp Cloud API)   │                   │ whatsapp-webhook (Deno)  │
└──────────────┘              └───────────────────────┘                   └────────────┬─────────────┘
                                         ▲  confirmación (opcional)                    │ service_role
                                         └─────────────────────────────────────────────┤
                                                                                       ▼
┌────────────────────────────┐   Realtime / REST (RLS)   ┌──────────────────────────────────────────┐
│ Dashboard React (Vercel)   │ ◀───────────────────────▶ │ Supabase PostgreSQL                      │
│ clave publicable + sesión  │                           │ links · categories · job_details ·       │
└─────────────┬──────────────┘                           │ settings · webhook_events · link_history │
              │ links-api (añadir, re-analizar, estado)  │ pg_cron: archive_expired_links() c/hora  │
              └────────────────────────────────────────▶ └──────────────────────────────────────────┘
```

**Por qué este stack** (ligeros ajustes sobre el propuesto):

- **Supabase Edge Functions** en lugar de un servidor Node aparte: el webhook vive junto a la base de datos, escala a
  cero, no requiere un segundo proveedor y el plan gratuito cubre de sobra el uso personal.
- **pg_cron** dentro de PostgreSQL para el archivado: la regla se ejecuta donde están los datos, de forma atómica, sin
  depender de un cron externo ni de que el frontend esté abierto.
- **Gráficos SVG propios** en lugar de una librería de gráficos: menos peso y estilos coherentes con el tema.
- **Extracción de metadatos con un analizador de texto** (no un navegador sin cabeza): nunca se ejecuta JavaScript de
  las páginas enlazadas y el riesgo de SSRF queda acotado.

## Funcionalidades

| Área               | Qué hace                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingesta            | WhatsApp (texto, leyendas de imagen/vídeo/documento, varias URLs por mensaje), simulador de mensajes y alta manual.                            |
| Duplicados         | URL normalizada única por usuario; volver a compartir actualiza la fecha y el contador y devuelve el enlace a la bandeja.                      |
| Metadatos          | Open Graph, Twitter Cards, `<title>`, JSON-LD `JobPosting`. Fallo seguro con mensaje claro.                                                    |
| Clasificación      | 12 categorías iniciales por dominio y palabras clave; IA opcional. Corrección manual que la IA no vuelve a pisar.                              |
| Ofertas laborales  | Empresa, cargo, ubicación, modalidad, fechas, salario, estado de la oportunidad y de la postulación. Sólo se rellena lo que la página declara. |
| Estados            | Nuevo, pendiente, visto (registra la fecha), en seguimiento, archivado, descartado + favorito. Historial de cambios.                           |
| Retención          | 7 días por defecto (1–365). Archivado lógico cada hora. Protegidos: favoritos, seguimiento, postulación iniciada/postulado. Restauración.      |
| Dashboard          | 8 indicadores, «Para revisar hoy», resumen del día, distribución por categorías, evolución de 30 días.                                         |
| Búsqueda y filtros | Búsqueda sin tildes en título, URL, dominio, categoría, etiquetas, notas, empresa y cargo. 12 filtros y 5 órdenes. 11 vistas.                  |
| Exportación        | CSV (con protección contra inyección de fórmulas) y JSON de la vista filtrada; copia de seguridad completa en JSON.                            |
| Ajustes            | Estado real de cada integración, números autorizados, simulador, eventos del webhook, retención, tema, notificaciones, datos demo.             |

## Estructura del repositorio

```
├─ src/                       Frontend (React + TS)
│  ├─ lib/logic.ts            Reglas puras: vistas, filtros, retención, indicadores, CSV  (con pruebas)
│  ├─ hooks/useVault.ts       Carga, Realtime y mutaciones contra Supabase
│  ├─ components/             Tarjeta de enlace, panel de detalles, gráficos, UI base
│  └─ views/                  Inicio, listas, ajustes, autenticación
├─ supabase/
│  ├─ migrations/             Esquema, funciones/disparadores, RLS + Realtime + pg_cron (versionadas)
│  ├─ functions/
│  │  ├─ whatsapp-webhook/    Webhook oficial de Meta (+ modo de prueba)
│  │  ├─ links-api/           API autenticada del dashboard
│  │  └─ _shared/             URLs, SSRF, metadatos, clasificación, IA, WhatsApp, pipeline
│  └─ config.toml             verify_jwt=false (cada función valida su propia autenticación)
├─ tests/                     Vitest: URLs, SSRF, metadatos, clasificación, WhatsApp, lógica del dashboard
├─ docs/WHATSAPP.md           Guía de conexión con Meta
└─ .github/workflows/ci.yml   Formato, lint, tipos, pruebas, build y `deno check`
```

## Instalación paso a paso

> Pensado para ejecutarse desde Claude Code o una terminal. Necesitas Node.js 20+ y una cuenta de Supabase.

### 1. Clonar e instalar

```bash
git clone https://github.com/davidenriespe/linkvault.git
cd linkvault
npm install
```

### 2. Base de datos

El proyecto de Supabase **`linkvault` (`jmtglvtvfikiqfomrqgp`) ya está creado** y con las tres migraciones aplicadas,
la tarea `pg_cron` programada y las dos Edge Functions desplegadas.

Para recrearlo en otro proyecto:

```bash
npx supabase login
npx supabase link --project-ref TU_PROYECTO
npx supabase db push                       # aplica supabase/migrations
npx supabase functions deploy whatsapp-webhook
npx supabase functions deploy links-api
```

### 3. Variables del frontend

```bash
cp .env.example .env.local
```

Rellena `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (Supabase → Project Settings → API Keys). Son valores
**públicos**: la seguridad la aplica RLS. Nunca pongas la clave `service_role` ni tokens de WhatsApp en `.env.local`.

### 4. Ejecutar

```bash
npm run dev        # http://localhost:5173
```

### 5. Crear tu cuenta y cerrar el registro

1. Abre la app → **Crear una cuenta** → confirma el correo.
2. Como es una app personal, **desactiva nuevos registros**: Supabase → Authentication → Sign In / Providers →
   desactiva _Allow new users to sign up_. (Aunque alguien se registrara, RLS le impediría ver tus datos.)
3. En Supabase → Authentication → URL Configuration, pon tu dominio de producción como **Site URL** y añádelo a
   **Redirect URLs** (los correos de confirmación y de recuperación apuntan ahí).

### 6. Probar sin WhatsApp

**Ajustes → Simulador de mensajes**: envía un mensaje con URLs al webhook real en modo de prueba. Recorre todo el flujo
y los enlaces aparecen marcados como _Simulación_. También puedes **cargar datos de demostración** (marcados como _Demo_
y eliminables con un clic).

## Despliegue en GitHub Pages (activo)

La app se publica sola en **https://davidenriespe.github.io/linkvault/** con cada `git push` a `main`
(`.github/workflows/pages.yml`): compila con la subruta `/linkvault/` y sube `dist/` a la rama `gh-pages`.

Si la URL responde 404 tras el primer despliegue: GitHub → repositorio → **Settings → Pages** →
_Source: Deploy from a branch_ → rama `gh-pages`, carpeta `/ (root)` → **Save**.

Después, en Supabase → Authentication → URL Configuration, pon `https://davidenriespe.github.io/linkvault/`
como **Site URL** y añádela a **Redirect URLs** (los correos de confirmación y recuperación vuelven ahí).

## Despliegue en Vercel (alternativa)

1. <https://vercel.com/new> → **Import Git Repository** → `davidenriespe/linkvault` (Vercel detecta Vite).
2. **Environment Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y, opcional, `VITE_GITHUB_REPO=davidenriespe/linkvault`.
3. **Deploy**. Cada `git push` a `main` vuelve a desplegar; las PR obtienen URL de vista previa.
4. Copia la URL de producción en Supabase → Authentication → URL Configuration (paso 5.3).

`vercel.json` ya incluye la reescritura SPA y cabeceras de seguridad. Para Netlify existe `netlify.toml`.

Los enlaces recibidos **no requieren commits**: viven en Supabase y el dashboard desplegado los muestra al instante.

## Conectar WhatsApp

Guía completa en **[docs/WHATSAPP.md](docs/WHATSAPP.md)**. Resumen:

1. Crear app en Meta for Developers con el producto WhatsApp.
2. Copiar el **Phone Number ID** y añadir tu número como destinatario de prueba.
3. Crear un **token permanente** de usuario del sistema.
4. Guardar `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` como secretos de Edge Functions.
5. Configurar el webhook `https://jmtglvtvfikiqfomrqgp.supabase.co/functions/v1/whatsapp-webhook` y suscribirse a `messages`.
6. Registrar tu número en **Ajustes → Números autorizados** y compartir un enlace.

### IA opcional

Añade el secreto `ANTHROPIC_API_KEY` (y opcionalmente `AI_MODEL`, por defecto `claude-haiku-5-5`). Se usa para resumir
y etiquetar, y para clasificar sólo cuando las reglas no tienen confianza suficiente. Sin la clave todo sigue funcionando.

## Seguridad

- **RLS** en todas las tablas: cada usuario sólo ve y modifica sus filas. `anon` no tiene permisos. `integration_state`
  sólo es accesible por el backend.
- **Secretos** únicamente en Supabase (Edge Function secrets). El frontend sólo conoce la URL y la clave publicable.
- **Webhook**: firma HMAC-SHA256 obligatoria (comparación en tiempo constante), límite de 256 KB, remitentes autorizados,
  idempotencia por id de mensaje, límite de 30 enlaces/minuto por usuario.
- **SSRF** al obtener metadatos: sólo `http/https`, puertos 80/443, sin credenciales en la URL; bloqueo de hosts internos
  (`localhost`, `.local`, `.internal`, metadatos de nube…), de IPv4/IPv6 privadas, loopback, link-local, CGNAT, multicast y
  reservadas (incluidas IPv4 mapeadas en IPv6, NAT64 y 6to4); **resolución DNS y revalidación en cada redirección** (máx. 5);
  tiempo máximo 8 s; 1 MB máximo; sólo HTML; nunca se ejecuta código de la página ni se descargan archivos.
  _Riesgo residual documentado_: entre la resolución DNS y la conexión un dominio podría cambiar de IP (DNS rebinding);
  las Edge Functions corren aisladas de la red interna del proyecto, lo que limita el impacto.
- **XSS**: React escapa todo el texto; títulos y descripciones se limpian en el servidor; los enlaces y las imágenes sólo
  se muestran si son `http(s)` (validado también por `CHECK` en la base de datos); imágenes con `referrerPolicy=no-referrer`.
- **Inyección de prompts**: el texto de las páginas se trata como no confiable y la respuesta de la IA se valida contra
  una lista cerrada de categorías.
- **Registros** sin secretos ni números completos (sólo los 4 últimos dígitos del remitente).
- Funciones `SECURITY DEFINER` con `search_path` vacío y permisos de ejecución revocados a los clientes cuando no corresponden.

## Pruebas y CI

```bash
npm test            # 97 pruebas (Vitest)
npm run check       # formato + lint + tipos + pruebas + build
```

GitHub Actions (`.github/workflows/ci.yml`) ejecuta lo mismo en cada push/PR y además `deno check` de las Edge Functions.

La lógica de base de datos (alta de usuario, deduplicación, archivado y protecciones, restauración, fecha de revisión,
recompartir) se verificó con un script SQL transaccional contra el proyecto real.

## Costes y límites

| Servicio             | Plan         | Límites relevantes para uso personal                                                                                                                                                                    |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase             | Free         | 500 MB de base de datos, 500 000 invocaciones de Edge Functions/mes. **El proyecto se pausa tras 7 días sin actividad**; se reactiva desde el panel. Correos de autenticación con límite bajo por hora. |
| Vercel               | Hobby        | Gratis para uso personal no comercial.                                                                                                                                                                  |
| WhatsApp Cloud API   | —            | Recibir es gratis. Desde el 1-oct-2026, 1 000 respuestas de servicio gratis/mes por número; después, tarifa por mensaje.                                                                                |
| Anthropic (opcional) | Pago por uso | Unos céntimos por cada cientos de enlaces con un modelo pequeño.                                                                                                                                        |

## Estado actual y pendientes

- ✅ Base de datos, RLS, Realtime, pg_cron, Edge Functions desplegadas en `jmtglvtvfikiqfomrqgp`.
- ✅ Dashboard completo, búsqueda, filtros, exportación, ajustes con estado real, simulador.
- ⏳ **WhatsApp real**: requiere tus credenciales de Meta (pasos 1–6 de [docs/WHATSAPP.md](docs/WHATSAPP.md)). Hasta entonces
  la app indica «No conectado» y sólo funciona el simulador.
- ✅ **Publicada en GitHub Pages**: <https://davidenriespe.github.io/linkvault/> (se actualiza con cada push a `main`).
- ⏳ Supabase → Authentication → URL Configuration: poner la URL de Pages como Site URL y Redirect URL.
- ⏳ Borrar el usuario de prueba `e2e-test@linkvault.invalid` (Authentication → Users).
- ⏳ Desactivar nuevos registros en Supabase Auth después de crear tu cuenta.
- Posibles mejoras: envío del resumen diario por correo, PWA instalable con «Compartir con LinkVault» directo (Web Share Target).
