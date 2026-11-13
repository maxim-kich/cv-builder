export function createOpenApiDocument(publicUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "CV Builder API",
      version: "1.0.0",
      description: "Create, edit, list, delete, and export persistent CV documents.",
    },
    servers: [{ url: `${publicUrl}/api/v1` }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/templates/guide": { get: { summary: "Read agent template authoring guide and complete starter TSX", responses: { "200": { description: "Authoring guide" } } } },
      "/templates": {
        get: { summary: "List built-in and personal template metadata", responses: { "200": { description: "Template metadata" } } },
        post: { summary: "Upload a new immutable React PDF template after user approval", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UploadTemplate" } } } }, responses: { "201": { description: "Saved template and compact/long parsing reports" }, "400": { description: "Invalid package" }, "422": { description: "Rendering or parsing checks failed" } } },
      },
      "/templates/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "Retrieve full TSX/font package; builtin:classic returns a portable copy", responses: { "200": { description: "Template package" }, "404": { description: "Unavailable" } } },
        delete: { summary: "Delete personal library template; CV snapshots remain intact", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["expectedRevision"], properties: { expectedRevision: { type: "integer", minimum: 1 } } } } } }, responses: { "204": { description: "Deleted" }, "404": { description: "Unavailable or built-in" }, "409": { description: "Revision conflict" } } },
      },
      "/cvs/{id}/preview": { post: { summary: "Render a draft with the saved CV template without persisting it", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["resume", "hideLanguageDots"], properties: { resume: { type: "object" }, hideLanguageDots: { type: "boolean" } } } } } }, responses: { "200": { description: "PDF preview" }, "422": { description: "Template or parsing check failed" } } } },
      "/health": { get: { security: [], summary: "Check service health", responses: { "200": { description: "Healthy" } } } },
      "/cvs": {
        get: { summary: "List CVs", responses: { "200": { description: "CV documents" } } },
        post: {
          summary: "Create a CV from structured fields or Markdown",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateCv" } } } },
          responses: { "201": { description: "Created CV" } },
        },
      },
      "/cvs/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "Get a CV", responses: { "200": { description: "CV document" }, "404": { description: "Not found" } } },
        patch: {
          summary: "Update CV fields",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateCv" } } } },
          responses: { "200": { description: "Updated CV" }, "409": { description: "Revision conflict" } },
        },
        delete: { summary: "Delete a CV", responses: { "204": { description: "Deleted" } } },
      },
      "/cvs/{id}/markdown": {
        get: {
          summary: "Export CV as Markdown",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Markdown file" } },
        },
      },
      "/cvs/{id}/pdf": {
        get: {
          summary: "Export CV as PDF",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "PDF file" } },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: {
        UploadTemplate: { type: "object", additionalProperties: false, required: ["title", "source"], properties: {
          title: { type: "string", minLength: 1, maxLength: 200 }, source: { type: "string", minLength: 1, maxLength: 100000, description: "React PDF TSX default export; read /templates/guide first" },
          copyFontsFrom: { type: "string", description: "Reuse fonts from an owner template ID or builtin:classic" },
          fonts: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["family", "data"], properties: { family: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9 _-]{0,63}$" }, data: { type: "string", maxLength: 1400000, description: "Raw base64 TTF/OTF; not a URL" }, weight: { type: "integer", minimum: 100, maximum: 900, default: 400 }, style: { enum: ["normal", "italic"], default: "normal" } } } },
        } },
        CreateCv: {
          type: "object",
          properties: {
            title: { type: "string", default: "Untitled" },
            resume: { type: "object", description: "Structured ResumeData object" },
            markdown: { type: "string", description: "CV Builder Markdown; mutually exclusive with resume" },
            templateId: { type: "string", description: "ID from /templates; builtin:classic restores default. On update requires expectedRevision." },
            hideLanguageDots: { type: "boolean", default: false },
          },
        },
        UpdateCv: {
          type: "object",
          properties: {
            title: { type: "string" },
            resume: { type: "object" },
            markdown: { type: "string" },
            templateId: { type: "string", description: "ID from /templates; builtin:classic restores default. On update requires expectedRevision." },
            hideLanguageDots: { type: "boolean" },
            expectedRevision: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  };
}
