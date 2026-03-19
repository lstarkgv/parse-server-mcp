# Parse Server MCP Server

> Model Context Protocol (MCP) Server for Parse Server
> Enables AI assistants (Claude, GPT, etc.) to interact with Parse Server databases following all Parse-specific rules

[![NPM Version](https://img.shields.io/npm/v/@parse-server/mcp-server)](https://www.npmjs.com/package/@parse-server/mcp-server)
[![License: MIT](https://img.shields.io/npm/l/@parse-server/mcp-server)](https://www.npmjs.com/package/@parse-server/mcp-server)

---

## 🚀 Características

- ✅ **Listar y examinar schemas** - Ver todas las clases con sus campos y permisos
- ✅ **Crear y actualizar clases** - Con validación completa de reglas Parse
- ✅ **Queries con Pointer/Relation** - Soporte para relaciones complejas
- ✅ **CRUD de objetos** - Crear, leer, actualizar, eliminar objetos
- ✅ **Recomendaciones AI** - Sugerencias automáticas Pointer vs Relation
- ✅ **Validación de schemas** - Verifica reglas antes de crear
- ✅ **Generación de migraciones** - Crea archivos de migración listos para usar
- ✅ **Servidor HTTP** - Compatible con Claude CLI y otras herramientas MCP

---

## 📦 Instalación

### Instalación Global (Recomendado)

```bash
npm install -g @parse-server/mcp-server
```

### Instalación Local en tu Proyecto

```bash
cd tu-proyecto
npm install @parse-server/mcp-server
```

### Desde GitHub

```bash
git clone https://github.com/lstarkgv/parse-server-mcp.git
cd parse-server-mcp
npm install
```

---

## ⚙️ Configuración

### Variables de Entorno

Crea un archivo `.env` en el directorio raíz de tu proyecto Parse Server o en el directorio donde ejecutes el MCP Server:

```bash
# Copia el archivo de ejemplo
cp .env.example .env

# Edítalo con tus credenciales
```

**Variables requeridas:**

```bash
# Parse Server Configuration
PARSE_SERVER_URL=http://localhost:1338/api    # URL de tu Parse Server
APP_ID=your_app_id                        # Application ID de Parse
MASTER_KEY=your_master_key_here            # Master Key de Parse

# Opcionales
MCP_PORT=3001                             # Puerto del servidor MCP (default: 3001)
```

**Importante:** `PARSE_SERVER_URL` debe incluir el mount point (ej: `/api`, `/parse`, etc.)

---

## 🎯 Modos de Uso

### Modo 1: Servidor HTTP (Recomendado para Claude CLI)

Ideal para usar con **Claude CLI**:

```bash
# Iniciar servidor HTTP
npx @parse-server/mcp-server http

# O si está instalado globalmente
parse-mcp http
```

El servidor escuchará en: `http://localhost:3001/mcp`

**Configuración en Claude Desktop:**

Edita tu archivo de configuración de Claude Desktop:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "parse-server": {
      "command": "parse-mcp",
      "args": ["http"],
      "env": {
        "PARSE_SERVER_URL": "http://localhost:1338/api",
        "APP_ID": "your_app_id",
        "MASTER_KEY": "your_master_key_here"
      }
    }
  }
}
```

### Modo 2: Stdio (Para Claude Desktop)

Para usar con **Claude Desktop** directamente:

```bash
npx @parse-server/mcp-server

# O globalmente
parse-mcp
```

**Configuración en Claude Desktop:**

```json
{
  "mcpServers": {
    "parse-server": {
      "command": "parse-mcp",
      "args": [],
      "env": {
        "PARSE_SERVER_URL": "http://localhost:1338/api",
        "APP_ID": "your_app_id",
        "MASTER_KEY": "your_master_key_here"
      }
    }
  }
}
```

---

## 🛠️ Herramientas MCP Disponibles

| Herramienta | Descripción |
|-------------|-------------|
| `parse_list_schemas` | Listar todas las clases con campos y permisos |
| `parse_get_schema` | Obtener schema detallado de una clase específica |
| `parse_create_schema` | Crear nueva clase con validación Parse |
| `parse_update_schema` | Actualizar schema de una clase existente |
| `parse_query` | Queries con soporte para Pointer/Relation |
| `parse_create_object` | Crear nuevo objeto en una clase |
| `parse_get_object` | Obtener objeto por ID |
| `parse_update_object` | Actualizar objeto existente |
| `parse_delete_object` | Eliminar objeto |
| `parse_recommend_relation` | Recomendar Pointer vs Relation |
| `parse_validate_schema` | Validar schema sin crear |
| `parse_create_migration` | Crear archivo de migración |

---

## 💻 Ejemplos de Uso

### Con Claude CLI

Una vez configurado, puedes usar Claude naturalmente:

```
Claude, ¿qué clases tengo en mi base de datos Parse?

Claude, muéstrame el schema de la clase Article

Claude, crea una clase "Comment" con:
- content (String, requerido)
- author (Pointer a _User)
- post (Pointer a Post)
- CLP: usuarios autenticados pueden leer y crear

Claude, ¿qué tipo de relación debería usar para:
Un Article que pertenece a muchos Category?
```

### Como Módulo en tu Proyecto

También puedes usarlo como módulo dentro de tu proyecto:

```javascript
import { ParseMCP } from '@parse-server/mcp-server';

// Inicializar servidor
const server = new ParseMCP({
  parseServerUrl: 'http://localhost:1338/api',
  appId: 'your_app_id',
  masterKey: 'your_master_key'
});

await server.start();
```

---

## 🔄 Generación de Migraciones

El MCP Server puede generar archivos de migración automáticamente en tu proyecto Parse Server.

### Configuración de Ruta del Proyecto

Agrega la ruta de tu proyecto Parse Server a tu archivo `.env`:

```bash
# Ruta absoluta a tu proyecto Parse Server
PARSE_PROJECT_PATH=/Users/usuario/proyectos/mi-parse-server
```

O especifica la ruta directamente al llamar a la herramienta:

```
Claude, crea una migración para la clase "Product" en el proyecto "/ruta/a/mi-proyecto"
```

### Creación Automática vs Manual

**Con PARSE_PROJECT_PATH configurado:**
- El archivo se crea automáticamente en `{PROJECT_PATH}/migrations/`
- Incluye timestamp: `1234567890_add_product_table.js`
- La carpeta `migrations/` se crea si no existe

**Sin configurar:**
- Se genera el contenido del archivo como texto
- Debes copiar y pegar manualmente en tu proyecto

### Formato de Migración

Las migraciones generadas siguen el formato estándar:

```javascript
'use strict';

module.exports = {
  description: 'add_product_table',

  async up({ createSchema, addField, addIndex }) {
    await createSchema('Product', {
      fields: {
        name: { type: 'String' },
        price: { type: 'Number' },
        category: { type: 'Pointer', targetClass: 'Category' }
      },
      classLevelPermissions: {
        find: { '*': true },
        get: { '*': true }
      }
    });
  },

  async down({ deleteSchema }) {
    await deleteSchema('Product');
  }
};
```

### Ejecutar Migraciones

Después de que el MCP crea la migración:

```bash
cd /ruta/a/tu/proyecto/parse
npm run migrate
```

---

## 📖 Reglas de Parse Server Aplicadas

### Nombres de Clases
- ✅ **PascalCase**: `UserProfile`, `OrderItem`
- ❌ **camelCase**: `userProfile`
- ❌ **snake_case**: `user_profile`
- ❌ No empezar con `_` (reservado para sistema)

### Nombres de Campos
- ✅ **camelCase**: `firstName`, `phoneNumber`
- ❌ **No empezar con `_`**
- ❌ **No usar**: `objectId`, `createdAt`, `updatedAt`, `ACL`

### Tipos de Relaciones

**Pointer** (N:1 o 1:1):
```javascript
{
  "owner": {
    "type": "Pointer",
    "targetClass": "Company"
  }
}
```
Usar para: "algo pertenece a algo", relaciones padre-hijo

**Relation** (N:M):
```javascript
{
  "categories": {
    "type": "Relation",
    "targetClass": "Category"
  }
}
```
Usar para: "algo tiene muchos", muchos-a-muchos

### Permisos CLP

```javascript
{
  "classLevelPermissions": {
    "find": { "*": true, "requiresAuthentication": true },
    "get": { "*": true },
    "create": { "role:Admin": true },
    "update": { "role:Admin": true },
    "delete": { "role:SuperAdmin": true }
  }
}
```

---

## 🔍 Troubleshooting

### "Connection refused"

- Asegúrate que **Parse Server está corriendo**:
  ```bash
  # Verificar que Parse Server responde
  curl http://localhost:1338/api/health
  ```

- Verifica la URL en tu archivo `.env`

### "Invalid credentials"

- Verifica `APP_ID` y `MASTER_KEY` en tu `.env`
- Usa el **MASTER_KEY** (no READ_ONLY_MASTER_KEY)

### "Class not found"

- Los nombres de clases son **case-sensitive**
- Usa **PascalCase**: `Article` no `article`

### "MCP Server no aparece"

- Verifica que el servidor MCP está corriendo: `npx @parse-server/mcp-server http`
- Revisa la configuración en Claude Desktop

---

## 📚 Documentación Completa

Para más información sobre:
- **Uso con Claude CLI**: Ver documentación de Claude Desktop
- **Parse Server**: https://docs.parseplatform.org/
- **Model Context Protocol**: https://modelcontextprotocol.io/
- **MCP Servers**: https://modelcontextprotocol.io/docs/concepts/servers/

---

## 🤝 Contribuir

Contribuciones son bienvenidas! Por favor:
1. Fork el repositorio
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add amazing feature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

---

## 📄 Licencia

MIT License - ver archivo LICENSE para detalles

---

## 🌟 Star History

Si te resulta útil, considera darle una estrella ⭐ al repositorio en GitHub.

---

## 👤 Autor

**lstarkgv** - [GitHub](https://github.com/lstarkgv)

---

**Made with ❤️ for the Parse Server community**

© 2025 lstarkgv - MIT License

[GitHub Repository](https://github.com/lstarkgv/parse-server-mcp)
