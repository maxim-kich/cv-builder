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
        CreateCv: {
          type: "object",
          properties: {
            title: { type: "string", default: "Untitled" },
            resume: { type: "object", description: "Structured ResumeData object" },
            markdown: { type: "string", description: "CV Builder Markdown; mutually exclusive with resume" },
            hideLanguageDots: { type: "boolean", default: false },
          },
        },
        UpdateCv: {
          type: "object",
          properties: {
            title: { type: "string" },
            resume: { type: "object" },
            markdown: { type: "string" },
            hideLanguageDots: { type: "boolean" },
            expectedRevision: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  };
}
