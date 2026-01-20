# Verificador FULL

App para verificar envíos FULL de MercadoLibre.

## Configuración

1. Copiar `.env.example` a `.env` y completar las variables
2. `npm install`
3. `npm start`

## Variables de entorno

- `AUTH_USER` / `AUTH_PASSWORD`: Credenciales de acceso
- `GOOGLE_SHEET_ID`: ID del Google Sheet con los códigos
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Email de la service account
- `GOOGLE_PRIVATE_KEY`: Private key de la service account
- `ANTHROPIC_API_KEY`: API key de Claude para verificación con fotos

## Uso

1. Escanear código ML (ej: RRSM05395)
2. Verificar los items mostrados
3. Opcionalmente usar foto para verificación con IA
4. Confirmar verificación
