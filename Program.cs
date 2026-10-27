using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;

var resetAdmin = args.Contains("--reset-admin");
var builder = WebApplication.CreateBuilder(args.Where(arg => arg != "--reset-admin").ToArray());
var cloud = new CloudDocuments();
builder.Services.AddSingleton(cloud);
var port = Environment.GetEnvironmentVariable("PORT");
if (int.TryParse(port, out var portNumber) && portNumber is > 0 and <= 65535) builder.WebHost.UseUrls($"http://0.0.0.0:{portNumber}");
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("ForkAndFlame");
if (cloud.Enabled)
    builder.Services.Configure<KeyManagementOptions>(options => options.XmlRepository = new BlobKeyRepository(cloud));
else
{
    var keyDirectory = Path.Combine(builder.Environment.ContentRootPath, "App_Data", "keys");
    Directory.CreateDirectory(keyDirectory);
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));
    if (OperatingSystem.IsWindows()) dataProtection.ProtectKeysWithDpapi();
}
builder.Services.AddSingleton<AppStore>();
builder.Services.AddSingleton<AdminCredentials>();
builder.Services.AddSingleton<LoginGuard>();
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(options =>
{
    options.Cookie.Name = "forkflame.staff";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = cloud.Enabled ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
    options.ExpireTimeSpan = TimeSpan.FromHours(12);
    options.SlidingExpiration = true;
    options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
    options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
    options.Events.OnValidatePrincipal = context =>
    {
        var stamp = context.Principal?.FindFirstValue("stamp");
        if (stamp != context.HttpContext.RequestServices.GetRequiredService<AdminCredentials>().Stamp)
            context.RejectPrincipal();
        return Task.CompletedTask;
    };
});
builder.Services.AddAuthorization();

var app = builder.Build();
var credentials = app.Services.GetRequiredService<AdminCredentials>();
if (resetAdmin) credentials.Reset();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api")) context.Response.Headers.CacheControl = "no-store";
    try { await next(); }
    catch (Exception error) when (error is HttpRequestException or IOException)
    {
        app.Logger.LogError(error, "Persistent storage request failed");
        if (context.Response.HasStarted) throw;
        context.Response.Clear(); context.Response.StatusCode = 503;
        await context.Response.WriteAsJsonAsync(new { error = "Order storage is temporarily unavailable. Please try again. Your checkout can be retried safely." });
    }
});
app.MapGet("/api/health", async (AppStore store) =>
{
    await store.ReadAsync(state => state.Restaurants.Count);
    return Results.Ok(new { status = "ok", application = "Crave", storage = cloud.Enabled ? "private-blob" : "local" });
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/restaurants", async (AppStore store) =>
    Results.Ok(await store.ReadAsync(state => state.Restaurants.Where(restaurant => restaurant.Available).ToList())));
app.MapGet("/api/menu", async (string? restaurantId, AppStore store) =>
    Results.Ok(await store.ReadAsync(state => state.Menu.Where(item => item.Available &&
        state.Restaurants.Any(restaurant => restaurant.Id == item.RestaurantId && restaurant.Available) &&
        (restaurantId == null || item.RestaurantId == restaurantId)).ToList())));

app.MapPost("/api/orders", async (CreateOrderRequest? request, AppStore store) =>
{
    if (request is null) return Results.BadRequest(new { error = "Order details are required." });
    return await store.WriteAsync<IResult>(state =>
    {
        if (request.ClientRequestId is not null)
        {
            if (!Guid.TryParse(request.ClientRequestId, out _)) return Results.BadRequest(new { error = "Invalid checkout request ID." });
            var previous = state.Orders.FirstOrDefault(order => order.ClientRequestId == request.ClientRequestId);
            if (previous is not null)
                return previous.Email.Equals(request.Customer?.Email?.Trim(), StringComparison.OrdinalIgnoreCase)
                    ? Results.Ok(previous) : Results.Conflict(new { error = "Please start a new checkout." });
        }
        var menu = state.Menu.ToDictionary(item => item.Id);
        var restaurants = state.Restaurants.ToDictionary(restaurant => restaurant.Id);
        var error = Rules.ValidateOrder(request, menu, restaurants);
        if (error is not null) return Results.BadRequest(new { error });
        var (quote, quoteError) = Rules.Quote(new QuoteRequest(request.RestaurantId, request.Fulfillment, request.Items, request.PromoCode, request.Tip), state);
        if (quoteError is not null) return Results.BadRequest(new { error = quoteError });
        var lines = request.Items!.Select(input =>
        {
            var item = menu[input.Id!];
            return new OrderLine(item.Id, item.Name, item.Price, input.Quantity);
        }).ToList();
        var priced = quote!;
        if (request.ExpectedTotal is not null && request.ExpectedTotal != priced.Total)
            return Results.Conflict(new { error = "Menu prices have changed. Refresh the total and review it before ordering." });
        var customer = request.Customer!;
        var order = new Order(
            Convert.ToHexString(RandomNumberGenerator.GetBytes(6)), DateTimeOffset.UtcNow, "Placed",
            customer.Name!.Trim(), customer.Email!.Trim(), customer.Phone!.Trim(), request.Fulfillment!,
            request.Fulfillment == "delivery" ? customer.Address!.Trim() : null, customer.Notes?.Trim(),
            lines, priced.Subtotal, priced.DeliveryFee, priced.Total, null, request.RestaurantId!, restaurants[request.RestaurantId!].Name,
            priced.Discount, priced.Tip, priced.PromoCode, DateTimeOffset.UtcNow.AddMinutes(priced.PrepMinutes), request.ClientRequestId, [new("Placed", DateTimeOffset.UtcNow)]);
        state.Orders.Add(order);
        return Results.Created($"/api/orders/{order.Id}", order);
    });
});

app.MapPost("/api/checkout/quote", async (QuoteRequest? request, AppStore store) =>
{
    if (request is null) return Results.BadRequest(new { error = "Cart details are required." });
    return await store.ReadAsync<IResult>(state =>
    {
        var (quote, error) = Rules.Quote(request, state);
        return error is null ? Results.Ok(quote) : Results.BadRequest(new { error });
    });
});

app.MapGet("/api/orders/{id}", async (string id, string? email, AppStore store) =>
{
    if (string.IsNullOrWhiteSpace(email)) return Results.BadRequest(new { error = "Enter the email used at checkout." });
    var order = await store.ReadAsync(state => state.Orders.FirstOrDefault(item =>
        item.Id.Equals(id, StringComparison.OrdinalIgnoreCase) && item.Email.Equals(email.Trim(), StringComparison.OrdinalIgnoreCase)));
    return order is null ? Results.NotFound(new { error = "No order found with that code and email." }) : Results.Ok(order);
});

app.MapPost("/api/orders/{id}/cancel", async (string id, CancelOrderInput? input, AppStore store) =>
{
    if (string.IsNullOrWhiteSpace(input?.Email)) return Results.BadRequest(new { error = "Enter the email used at checkout." });
    return await store.WriteAsync<IResult>(state =>
    {
        var index = state.Orders.FindIndex(order => order.Id.Equals(id, StringComparison.OrdinalIgnoreCase) &&
            order.Email.Equals(input.Email.Trim(), StringComparison.OrdinalIgnoreCase));
        if (index < 0) return Results.NotFound(new { error = "No order found with that code and email." });
        var order = state.Orders[index];
        if (order.Status is not ("Placed" or "Preparing"))
            return Results.Conflict(new { error = "This order can no longer be cancelled online. Please contact the restaurant." });
        var updated = order with { Status = "Cancelled", CourierLocation = null, StatusHistory = [.. order.StatusHistory ?? [], new("Cancelled", DateTimeOffset.UtcNow)] };
        state.Orders[index] = updated;
        return Results.Ok(updated);
    });
});

app.MapPost("/api/admin/login", async (LoginInput? input, HttpContext context, AdminCredentials secrets, LoginGuard guard) =>
{
    var key = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    if (!guard.CanTry(key)) return Results.Json(new { error = "Too many attempts. Try again in 15 minutes." }, statusCode: 429);
    if (!secrets.Verify(input?.Password))
    {
        guard.Fail(key);
        return Results.Unauthorized();
    }
    guard.Succeed(key);
    var csrf = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
    var claims = new[] { new Claim(ClaimTypes.Name, "Staff"), new Claim("csrf", csrf), new Claim("stamp", secrets.Stamp) };
    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
    return Results.Ok(new { authenticated = true, csrf });
});

var staff = app.MapGroup("/api/admin").RequireAuthorization();
staff.AddEndpointFilter(async (context, next) =>
{
    if (HttpMethods.IsGet(context.HttpContext.Request.Method)) return await next(context);
    var expected = context.HttpContext.User.FindFirstValue("csrf");
    var actual = context.HttpContext.Request.Headers["X-Admin-CSRF"].ToString();
    if (string.IsNullOrEmpty(expected) || !CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(expected), System.Text.Encoding.UTF8.GetBytes(actual)))
        return Results.StatusCode(403);
    return await next(context);
});

FeatureEndpoints.Map(app, staff);

staff.MapGet("/session", (HttpContext context) => Results.Ok(new { authenticated = true, csrf = context.User.FindFirstValue("csrf") }));
staff.MapPost("/logout", async (HttpContext context) => { await context.SignOutAsync(); return Results.Ok(); });
staff.MapPost("/password", async (PasswordChange? input, AdminCredentials secrets, HttpContext context) =>
{
    if (input is null || !secrets.Change(input.CurrentPassword, input.NewPassword))
        return Results.BadRequest(new { error = "Current password is incorrect or the new password is shorter than 12 characters." });
    await context.SignOutAsync();
    return Results.Ok(new { message = "Password changed. Sign in again." });
});

staff.MapGet("/orders", async (AppStore store) => Results.Ok(await store.ReadAsync(state =>
    state.Orders.OrderByDescending(order => order.PlacedAt).ToList())));
staff.MapPatch("/orders/{id}/status", async (string id, StatusInput? input, AppStore store) =>
{
    if (input?.Status is null) return Results.BadRequest(new { error = "Choose a status." });
    return await store.WriteAsync<IResult>(state =>
    {
        var index = state.Orders.FindIndex(order => order.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
        if (index < 0) return Results.NotFound(new { error = "Order not found." });
        var order = state.Orders[index];
        if (!Rules.CanTransition(order, input.Status)) return Results.Conflict(new { error = "This status change is not allowed." });
        var updated = order with { Status = input.Status, StatusHistory = [.. order.StatusHistory ?? [], new(input.Status, DateTimeOffset.UtcNow)], CourierLocation = input.Status is "Completed" or "Cancelled" ? null : order.CourierLocation };
        state.Orders[index] = updated;
        return Results.Ok(updated);
    });
});

staff.MapPut("/orders/{id}/location", async (string id, CourierLocationInput? input, AppStore store) =>
{
    if (input is null || !double.IsFinite(input.Latitude) || !double.IsFinite(input.Longitude) ||
        input.Latitude is < -90 or > 90 || input.Longitude is < -180 or > 180)
        return Results.BadRequest(new { error = "Enter valid latitude and longitude." });
    return await store.WriteAsync<IResult>(state =>
    {
        var index = state.Orders.FindIndex(order => order.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
        if (index < 0) return Results.NotFound(new { error = "Order not found." });
        var order = state.Orders[index];
        if (order.Fulfillment != "delivery" || order.Status != "Out for delivery")
            return Results.Conflict(new { error = "Location can be shared only while a delivery is out." });
        var updated = order with { CourierLocation = new CourierLocation(input.Latitude, input.Longitude, DateTimeOffset.UtcNow) };
        state.Orders[index] = updated;
        return Results.Ok(updated);
    });
});

staff.MapGet("/menu", async (AppStore store) => Results.Ok(await store.ReadAsync(state => state.Menu.ToList())));
staff.MapGet("/restaurants", async (AppStore store) => Results.Ok(await store.ReadAsync(state => state.Restaurants.ToList())));
staff.MapPost("/restaurants", async (RestaurantInput? input, AppStore store) =>
{
    if (input is null) return Results.BadRequest(new { error = "Restaurant details are required." });
    var error = Rules.ValidateRestaurant(input);
    if (error is not null) return Results.BadRequest(new { error });
    return await store.WriteAsync<IResult>(state =>
    {
        var restaurant = new Restaurant(Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant(),
            input.Name!.Trim(), input.Cuisine!.Trim(), input.Tagline!.Trim(), input.PrepMinutes,
            input.ImageKey!, input.Accent!, input.Available);
        state.Restaurants.Add(restaurant);
        return Results.Created($"/api/admin/restaurants/{restaurant.Id}", restaurant);
    });
});
staff.MapPut("/restaurants/{id}", async (string id, RestaurantInput? input, AppStore store) =>
{
    if (input is null) return Results.BadRequest(new { error = "Restaurant details are required." });
    var error = Rules.ValidateRestaurant(input);
    if (error is not null) return Results.BadRequest(new { error });
    return await store.WriteAsync<IResult>(state =>
    {
        var index = state.Restaurants.FindIndex(restaurant => restaurant.Id == id);
        if (index < 0) return Results.NotFound(new { error = "Restaurant not found." });
        var updated = state.Restaurants[index] with { Name = input.Name!.Trim(), Cuisine = input.Cuisine!.Trim(),
            Tagline = input.Tagline!.Trim(), PrepMinutes = input.PrepMinutes, ImageKey = input.ImageKey!,
            Accent = input.Accent!, Available = input.Available };
        state.Restaurants[index] = updated;
        return Results.Ok(updated);
    });
});
staff.MapPost("/menu", async (MenuInput? input, AppStore store) =>
{
    if (input is null) return Results.BadRequest(new { error = "Menu details are required." });
    var error = Rules.ValidateMenu(input);
    if (error is not null) return Results.BadRequest(new { error });
    return await store.WriteAsync<IResult>(state =>
    {
        if (!state.Restaurants.Any(restaurant => restaurant.Id == input.RestaurantId))
            return Results.BadRequest(new { error = "Choose an existing restaurant." });
        var item = new MenuItem(Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant(),
            input.Name!.Trim(), input.Category!.Trim(), input.Description!.Trim(), input.Price,
            input.Emoji!.Trim(), "peach", input.Popular, input.Available, input.RestaurantId!);
        state.Menu.Add(item);
        return Results.Created($"/api/admin/menu/{item.Id}", item);
    });
});
staff.MapPut("/menu/{id}", async (string id, MenuInput? input, AppStore store) =>
{
    if (input is null) return Results.BadRequest(new { error = "Menu details are required." });
    var error = Rules.ValidateMenu(input);
    if (error is not null) return Results.BadRequest(new { error });
    return await store.WriteAsync<IResult>(state =>
    {
        if (!state.Restaurants.Any(restaurant => restaurant.Id == input.RestaurantId))
            return Results.BadRequest(new { error = "Choose an existing restaurant." });
        var index = state.Menu.FindIndex(item => item.Id == id);
        if (index < 0) return Results.NotFound(new { error = "Menu item not found." });
        var old = state.Menu[index];
        var updated = old with { Name = input.Name!.Trim(), Category = input.Category!.Trim(), Description = input.Description!.Trim(),
            Price = input.Price, Emoji = input.Emoji!.Trim(), Popular = input.Popular, Available = input.Available,
            RestaurantId = input.RestaurantId! };
        state.Menu[index] = updated;
        return Results.Ok(updated);
    });
});
staff.MapDelete("/menu/{id}", async (string id, AppStore store) => await store.WriteAsync<IResult>(state =>
{
    var removed = state.Menu.RemoveAll(item => item.Id == id);
    return removed > 0 ? Results.NoContent() : Results.NotFound(new { error = "Menu item not found." });
}));

app.Run();
