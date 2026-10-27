# Crave — restaurant marketplace

A working ASP.NET Core 10 food marketplace with multiple restaurants, a customer storefront, and a staff dashboard. The C# server owns restaurant and menu data, prices, order validation, persistence, authentication, and status changes.

## Start it

1. Install the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0).
2. Extract this project and double-click `Start-FoodOrder.cmd` on Windows. Keep its console window open.
3. The storefront opens at **http://localhost:5000**. Staff can use **http://localhost:5000/admin.html**.
4. On the first start, the console prints a randomly generated **staff password**. Save it and change it in the staff dashboard.

You can also start it in a terminal from this directory:

```powershell
dotnet run --urls http://localhost:5000
```

Opening `wwwroot/index.html` directly shows a visual preview only. Checkout, tracking, and staff tools need the C# server.

## Customer features

- Browse restaurants, search by kitchen, cuisine, or dish, and filter by cuisine.
- Open a restaurant's menu and search or filter its dishes.
- Add items to a persistent browser cart and change quantities.
- Each cart belongs to one restaurant. Starting a bag at another restaurant asks before clearing the existing bag; the server also rejects mixed restaurant orders.
- Delivery costs $3.99 below a $30 food subtotal and is free at $30 or more. Ordering is delivery-only.
- Enter contact and delivery details, place an order, and receive a confirmation code.
- Track the order with its code **and checkout email** as staff update its status. The tracking panel refreshes every 15 seconds.
- Cancel an order from tracking while it is **Placed** or **Preparing**. Ready, completed, delivered, and previously cancelled orders cannot be cancelled online.
- For delivery orders, see the latest courier position on an OpenStreetMap map after staff shares a location. The map shows the last reported point, not continuous GPS tracking or an estimated arrival time.
- Pay on arrival. The app does not collect or charge card details.

## New customer conveniences

- Delivery-only ordering with the fee clearly shown before placing the order.
- Save favorite kitchens and sort by preparation time, average dish price, or name.
- Save contact and address details on this device only when you select the checkbox. Forget them from Delivery details.
- Use **FRESH10** for 10% off a food subtotal of $20 or more, capped at $8. Free delivery starts at a $30 food subtotal before discounts.
- Add an optional tip. The checkout quote, discount, fees, tip, and final order total are calculated by C#.
- View orders placed or looked up on this device, reorder available dishes at current prices, and download a text receipt from tracking.
- A retry of the same checkout request returns the existing order, and a changed total requires review before ordering.

Favorites and history use browser storage, not a customer account. Clearing browser storage removes these shortcuts. Order lookup still works with the confirmation code and email. The starter kitchens and menu are demonstration data; replace them with the restaurant's real details.

## Staff features

- Password-protected dashboard with order counts and totals.
- Add and edit restaurants, choose their featured photo style, and pause or resume ordering.
- Assign menu items to a restaurant when adding or editing dishes.
- Review order items, customer contact, address, and notes.
- Move orders through `Placed → Preparing → Ready → Out for delivery → Completed` for delivery. Staff may cancel an active order.
- While a delivery is **Out for delivery**, share the courier position using the browser’s location permission or enter latitude and longitude. The customer map updates on the next tracking refresh. Location sharing works over localhost or HTTPS.
- Add, edit, pause, resume, and delete menu items. Sold-out items disappear from the storefront and are rejected at checkout.
- Change the staff password; existing sessions are invalidated.

The application stores its menu, orders, password hash, and session keys in `App_Data/`, created on first start. This directory is excluded from the source ZIP. Back it up if the orders matter.

If the staff password is lost, stop the app and run:

```powershell
dotnet run -- --reset-admin --urls http://localhost:5000
```

The new password appears in the console. Keep this window open to use the app.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/menu` | Available menu items |
| `GET /api/restaurants` | Active restaurants |
| `GET /api/menu?restaurantId=...` | Available menu for one restaurant |
| `POST /api/orders` | Server-validated checkout with price-change and retry protection |
| `POST /api/checkout/quote` | Current prices, promo savings, optional tip, delivery fee, total, and preparation estimate |
| `GET /api/orders/{id}?email=...` | Customer tracking |
| `POST /api/orders/{id}/cancel` | Customer cancellation with checkout email, until ready |
| `POST /api/admin/login` | Staff login |
| `GET /api/admin/orders` | All orders |
| `GET /api/admin/restaurants` | All restaurants |
| `POST /api/admin/restaurants` | Add a restaurant |
| `PUT /api/admin/restaurants/{id}` | Edit or pause a restaurant |
| `PATCH /api/admin/orders/{id}/status` | Valid status change |
| `PUT /api/admin/orders/{id}/location` | Share courier coordinates for an active delivery |
| `GET /api/admin/menu` | Full menu |
| `POST /api/admin/menu` | Add menu item |
| `PUT /api/admin/menu/{id}` | Edit menu item |
| `DELETE /api/admin/menu/{id}` | Delete menu item |

Staff write routes require the authenticated session cookie and a CSRF header returned by the session endpoint.

## Deployment notes

This is fully usable as a single-server restaurant app with payment on arrival. For an internet-facing deployment, use HTTPS, a writable persistent volume for `App_Data`, backups, and one running app instance. The sample menu and USD pricing should be replaced with the restaurant’s own details. Multiple server instances need a shared database. Online card payments require a merchant account and payment provider integration.

Restaurant cards open a dedicated `/restaurant.html?id=...` menu page. Crave is the marketplace; Fork & Flame, Ember Pizza Co., and The Green Table are separate sample kitchens.

Tracking is available on the order confirmation and on placed orders in My orders. There are no tracking buttons in the browsing navigation. Pickup is not available for new orders or quotes.

## Hosted deployment

See DEPLOYMENT.md for the Vercel container, private cloud storage, required environment variables, and GitHub deployment flow.

