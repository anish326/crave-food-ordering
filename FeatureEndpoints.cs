using System.Security.Cryptography;

public record RestaurantReview(string Id, string OrderId, string RestaurantId, int Stars, string Comment, string DisplayName, DateTimeOffset CreatedAt);
public record ReviewInput(string? Email, int Stars, string? Comment);
public record OrderStatusEvent(string Status, DateTimeOffset At);

public static class FeatureEndpoints
{
    public static object Rating(AppState state, string restaurantId)
    {
        var reviews = state.Reviews.Where(r => r.RestaurantId == restaurantId).ToList();
        return new { restaurantId, count = reviews.Count, average = reviews.Count == 0 ? (double?)null : Math.Round(reviews.Average(r => r.Stars), 1) };
    }

    public static void Map(WebApplication app, RouteGroupBuilder staff)
    {
        app.MapGet("/api/ratings", async (AppStore store) => Results.Ok(await store.ReadAsync(s => s.Restaurants.Where(r => r.Available).Select(r => Rating(s, r.Id)).ToList())));
        app.MapGet("/api/restaurants/{id}/reviews", async (string id, AppStore store) => await store.ReadAsync<IResult>(s =>
            !s.Restaurants.Any(r => r.Id == id && r.Available) ? Results.NotFound() : Results.Ok(new {
                rating = Rating(s, id), reviews = s.Reviews.Where(r => r.RestaurantId == id).OrderByDescending(r => r.CreatedAt).Take(50)
                    .Select(r => new { r.Id, r.Stars, r.Comment, r.DisplayName, r.CreatedAt }) })));
        app.MapGet("/api/orders/{id}/review", async (string id, string? email, AppStore store) => await store.ReadAsync<IResult>(s => {
            var order = FindOrder(s, id, email);
            if (order is null) return Results.NotFound(new { error = "No order found with that code and email." });
            var review = s.Reviews.FirstOrDefault(r => r.OrderId == order.Id);
            return Results.Ok(new { eligible = order.Status == "Completed" && review is null, review = review is null ? null : new { review.Stars, review.Comment }, reason = order.Status != "Completed" ? "Reviews open after delivery is completed." : review is not null ? "Thank you. Your review has been published." : "" });
        }));
        app.MapPost("/api/orders/{id}/review", async (string id, ReviewInput? input, AppStore store) => {
            if (input is null || input.Stars is < 1 or > 5 || string.IsNullOrWhiteSpace(input.Comment) || input.Comment.Trim().Length is < 3 or > 1000)
                return Results.BadRequest(new { error = "Choose 1–5 stars and write a review of 3–1,000 characters." });
            return await store.WriteAsync<IResult>(s => {
                var order = FindOrder(s, id, input.Email);
                if (order is null) return Results.NotFound(new { error = "No order found with that code and email." });
                if (order.Status != "Completed") return Results.Conflict(new { error = "Only completed orders can be reviewed." });
                if (s.Reviews.Any(r => r.OrderId == order.Id)) return Results.Conflict(new { error = "You have already reviewed this order." });
                var name = order.CustomerName.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "Customer";
                var review = new RestaurantReview(Convert.ToHexString(RandomNumberGenerator.GetBytes(8)), order.Id, order.RestaurantId, input.Stars, input.Comment.Trim(), name, DateTimeOffset.UtcNow);
                s.Reviews.Add(review);
                return Results.Created($"/api/restaurants/{order.RestaurantId}/reviews", new { review.Id, review.Stars, review.Comment });
            });
        });
        app.MapGet("/api/restaurants/{id}/recommendations", async (string id, AppStore store) => await store.ReadAsync<IResult>(s => {
            if (!s.Restaurants.Any(r => r.Id == id && r.Available)) return Results.NotFound();
            var counts = s.Orders.Where(o => o.RestaurantId == id && o.Status == "Completed").SelectMany(o => o.Items).GroupBy(i => i.Id).ToDictionary(g => g.Key, g => g.Sum(i => i.Quantity));
            return Results.Ok(s.Menu.Where(m => m.RestaurantId == id && m.Available).OrderByDescending(m => counts.GetValueOrDefault(m.Id)).ThenByDescending(m => m.Popular).ThenBy(m => m.Name)
                .Select(m => new { item = m, completedOrdersQuantity = counts.GetValueOrDefault(m.Id) }).ToList());
        }));
        staff.MapGet("/analytics", async (string? period, string? restaurantId, AppStore store) => {
            if (period is not (null or "daily" or "weekly")) return Results.BadRequest(new { error = "Choose daily or weekly." });
            return Results.Ok(await store.ReadAsync(s => Analytics(s, period == "weekly", restaurantId)));
        });
    }

    private static Order? FindOrder(AppState s, string id, string? email) => string.IsNullOrWhiteSpace(email) ? null : s.Orders.FirstOrDefault(o => o.Id.Equals(id, StringComparison.OrdinalIgnoreCase) && o.Email.Equals(email.Trim(), StringComparison.OrdinalIgnoreCase));
    public static object Analytics(AppState s, bool weekly, string? restaurantId, DateTimeOffset? clock = null)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Kolkata");
        DateOnly LocalDate(DateTimeOffset date) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(date, zone).DateTime);
        var today = LocalDate(clock ?? DateTimeOffset.UtcNow);
        var endBucket = weekly ? today.AddDays(-((int)today.DayOfWeek + 6) % 7) : today;
        var bucketCount = weekly ? 8 : 7;
        var first = endBucket.AddDays(-(bucketCount - 1) * (weekly ? 7 : 1));
        var orders = s.Orders.Where(o => (string.IsNullOrEmpty(restaurantId) || o.RestaurantId == restaurantId) && LocalDate(o.PlacedAt) >= first && LocalDate(o.PlacedAt) <= today).ToList();
        decimal Sales(IEnumerable<Order> list) => list.Sum(o => o.Subtotal - o.Discount);
        var completed = orders.Where(o => o.Status == "Completed").ToList();
        var series = Enumerable.Range(0, bucketCount).Select(i => {
            var start = first.AddDays(i * (weekly ? 7 : 1)); var end = start.AddDays(weekly ? 7 : 1);
            var bucket = orders.Where(o => LocalDate(o.PlacedAt) >= start && LocalDate(o.PlacedAt) < end).ToList();
            return new { date = start.ToString("yyyy-MM-dd"), orders = bucket.Count, completed = bucket.Count(o => o.Status == "Completed"), cancelled = bucket.Count(o => o.Status == "Cancelled"), sales = Sales(bucket.Where(o => o.Status == "Completed")) };
        }).ToList();
        return new {
            timezone = "Asia/Kolkata", period = weekly ? "weekly" : "daily", from = first.ToString("yyyy-MM-dd"), to = today.ToString("yyyy-MM-dd"),
            totalOrders = orders.Count, completed = completed.Count, cancelled = orders.Count(o => o.Status == "Cancelled"), active = orders.Count(o => o.Status is not ("Completed" or "Cancelled")), sales = Sales(completed),
            averageOrder = completed.Count > 0 ? decimal.Round(Sales(completed) / completed.Count, 2) : 0m,
            series,
            popularDishes = completed.SelectMany(o => o.Items).GroupBy(i => i.Id).Select(g => new { id = g.Key, name = g.First().Name, quantity = g.Sum(i => i.Quantity) }).OrderByDescending(i => i.quantity).Take(5),
            restaurants = s.Restaurants.Where(r => string.IsNullOrEmpty(restaurantId) || r.Id == restaurantId).Select(r => new { id = r.Id, name = r.Name, orders = orders.Count(o => o.RestaurantId == r.Id), completed = completed.Count(o => o.RestaurantId == r.Id), sales = Sales(completed.Where(o => o.RestaurantId == r.Id)) }).OrderByDescending(r => r.sales)
        };
    }
}
