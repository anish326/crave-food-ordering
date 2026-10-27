# Crave deployment

Crave keeps its ASP.NET Core 10 C# API and HTML/CSS/JavaScript storefront. Vercel runs the API and storefront together using `Dockerfile.vercel`.

## Vercel environment variables

- `PORT=8080`
- `FOODORDER_STORAGE=vercel-blob`
- `BLOB_READ_WRITE_TOKEN`: a read/write token for the **private** `crave-data` Blob store.
- `FOODORDER_ADMIN_PASSWORD`: an initial staff password of 12–128 characters, set as an encrypted environment variable.

The initial staff password is used only when no cloud credential record exists. Later password changes are stored as salted PBKDF2 hashes. Secrets and real orders must never be committed to GitHub.

`FOODORDER_BLOB_PREFIX` is optional. By default, production uses `crave/production` and previews use `crave/preview`, preventing previews from using the production order or session documents. Local execution continues to use `App_Data/` unless cloud storage is explicitly selected.

Cloud orders, restaurant/menu edits, staff credential hashes, login limits, and session encryption keys are stored privately. Reads bypass object caching; writes use ETag preconditions and retry conflicts to avoid losing concurrent updates. This compact document store is intended for a small single-restaurant marketplace installation; migrate to a transactional database before high-volume production usage.

## Deployment flow

1. Push the source to the GitHub repository.
2. Import it into Vercel with the **Container** preset.
3. Set the environment variables above for production and preview.
4. Deploy. The image listens on `PORT` and Vercel supplies HTTPS.
5. Check `/api/health`, restaurant browsing, checkout quotes, order placement/tracking and staff login.

The cloud installation starts from the sample restaurants and menu. Local orders, passwords, and Windows-only session keys are not uploaded. New hosted orders live in cloud storage independently of the local application.

The application collects payment on arrival. The customer map shows the last position shared by staff, and the restaurant times are preparation estimates.
