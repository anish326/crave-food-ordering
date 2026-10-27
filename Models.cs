using System.Net.Mail;

public record Restaurant(string Id, string Name, string Cuisine, string Tagline, int PrepMinutes, string ImageKey, string Accent, bool Available = true);
public record MenuItem(string Id, string Name, string Category, string Description, decimal Price, string Emoji, string Color, bool Popular = false, bool Available = true, string RestaurantId = "fork-flame");
public record CustomerInput(string? Name, string? Email, string? Phone, string? Address, string? Notes);
public record OrderItemInput(string? Id, int Quantity);
public record CreateOrderRequest(string? Fulfillment, CustomerInput? Customer, List<OrderItemInput>? Items, string? RestaurantId, string? PromoCode = null, decimal Tip = 0m, decimal? ExpectedTotal = null, string? ClientRequestId = null);
public record QuoteRequest(string? RestaurantId, string? Fulfillment, List<OrderItemInput>? Items, string? PromoCode = null, decimal Tip = 0m);
public record OrderQuote(decimal Subtotal, decimal DeliveryFee, decimal Discount, decimal Tip, decimal Total, string? PromoCode, int PrepMinutes);
public record OrderLine(string Id, string Name, decimal UnitPrice, int Quantity);
public record CourierLocation(double Latitude, double Longitude, DateTimeOffset UpdatedAt);
public record Order(string Id, DateTimeOffset PlacedAt, string Status, string CustomerName, string Email, string Phone, string Fulfillment, string? Address, string? Notes, List<OrderLine> Items, decimal Subtotal, decimal DeliveryFee, decimal Total, CourierLocation? CourierLocation = null, string RestaurantId = "fork-flame", string? RestaurantName = null, decimal Discount = 0m, decimal Tip = 0m, string? PromoCode = null, DateTimeOffset? EstimatedReadyAt = null, string? ClientRequestId = null);
public record StatusInput(string? Status);
public record CancelOrderInput(string? Email);
public record CourierLocationInput(double Latitude, double Longitude);
public record MenuInput(string? Name, string? Category, string? Description, decimal Price, string? Emoji, bool Popular, bool Available, string? RestaurantId);
public record RestaurantInput(string? Name, string? Cuisine, string? Tagline, int PrepMinutes, string? ImageKey, string? Accent, bool Available);

public sealed class AppState
{
    public List<MenuItem> Menu { get; set; } = [];
    public List<Order> Orders { get; set; } = [];
    public List<Restaurant> Restaurants { get; set; } = [];
}

public static class Rules
{
    public const decimal FreeDeliveryThreshold = 30m;
    public const decimal DeliveryFee = 3.99m;

    public static (OrderQuote? Quote, string? Error) Quote(QuoteRequest request, AppState state)
    {
        var restaurant = state.Restaurants.FirstOrDefault(restaurant => restaurant.Id == request.RestaurantId && restaurant.Available);
        if (restaurant is null) return (null, "Choose an available restaurant.");
        if (request.Fulfillment != "delivery") return (null, "Only delivery is available.");
        if (request.Tip < 0m || request.Tip > 50m || decimal.Round(request.Tip, 2) != request.Tip)
            return (null, "Tip must be between $0 and $50, with at most two decimal places.");
        if (request.Items is null || request.Items.Count is < 1 or > 30) return (null, "Add 1 to 30 menu items.");
        if (request.Items.GroupBy(item => item.Id).Any(group => group.Count() > 1)) return (null, "Each item may appear once in the cart.");
        var menu = state.Menu.ToDictionary(item => item.Id);
        if (request.Items.Any(item => item.Id is null || !menu.TryGetValue(item.Id, out var dish) || !dish.Available ||
            dish.RestaurantId != request.RestaurantId || item.Quantity is < 1 or > 20))
            return (null, "Your cart contains an unavailable item or items from different restaurants. Refresh and try again.");
        var subtotal = request.Items.Sum(item => menu[item.Id!].Price * item.Quantity);
        var fee = request.Fulfillment == "delivery" && subtotal < FreeDeliveryThreshold ? DeliveryFee : 0m;
        if (request.PromoCode?.Length > 30) return (null, "Promo codes must be 30 characters or fewer.");
        var code = string.IsNullOrWhiteSpace(request.PromoCode) ? null : request.PromoCode.Trim().ToUpperInvariant();
        if (code is not null && code != "FRESH10") return (null, "That promo code is not valid.");
        if (code is not null && subtotal < 20m) return (null, "FRESH10 requires a food subtotal of at least $20.");
        var discount = code is null ? 0m : Math.Min(8m, decimal.Round(subtotal * .10m, 2, MidpointRounding.AwayFromZero));
        return (new OrderQuote(subtotal, fee, discount, request.Tip, subtotal - discount + fee + request.Tip, code, restaurant.PrepMinutes), null);
    }

    public static string? ValidateOrder(CreateOrderRequest request, IReadOnlyDictionary<string, MenuItem> menu, IReadOnlyDictionary<string, Restaurant> restaurants)
    {
        if (string.IsNullOrWhiteSpace(request.RestaurantId) || !restaurants.TryGetValue(request.RestaurantId, out var restaurant) || !restaurant.Available)
            return "Choose an available restaurant.";
        if (request.Fulfillment != "delivery") return "Only delivery is available.";
        if (request.Customer is null) return "Customer details are required.";
        var customer = request.Customer;
        if (string.IsNullOrWhiteSpace(customer.Name) || customer.Name.Length > 80) return "Enter a name of up to 80 characters.";
        if (string.IsNullOrWhiteSpace(customer.Email) || customer.Email.Length > 120 || !MailAddress.TryCreate(customer.Email, out _)) return "Enter a valid email address.";
        if (string.IsNullOrWhiteSpace(customer.Phone) || customer.Phone.Length > 30) return "Enter a phone number of up to 30 characters.";
        if (request.Fulfillment == "delivery" && (string.IsNullOrWhiteSpace(customer.Address) || customer.Address.Length > 240)) return "Enter a delivery address of up to 240 characters.";
        if (customer.Notes?.Length > 300) return "Notes must be 300 characters or fewer.";
        if (request.Items is null || request.Items.Count is < 1 or > 30) return "Add 1 to 30 menu items.";
        if (request.Items.Any(x => x.Id is null || !menu.TryGetValue(x.Id, out var item) || !item.Available || item.RestaurantId != request.RestaurantId || x.Quantity is < 1 or > 20)) return "Your cart contains an unavailable item or items from different restaurants. Refresh and try again.";
        if (request.Items.GroupBy(x => x.Id).Any(group => group.Count() > 1)) return "Each item may appear once in the cart.";
        return null;
    }

    public static string? ValidateMenu(MenuInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 80) return "Name must be 1 to 80 characters.";
        if (string.IsNullOrWhiteSpace(input.Category) || input.Category.Length > 40) return "Category must be 1 to 40 characters.";
        if (string.IsNullOrWhiteSpace(input.Description) || input.Description.Length > 240) return "Description must be 1 to 240 characters.";
        if (input.Price <= 0 || input.Price > 999m || decimal.Round(input.Price, 2) != input.Price) return "Price must be between $0.01 and $999.00, with at most two decimal places.";
        if (string.IsNullOrWhiteSpace(input.Emoji) || input.Emoji.Length > 12) return "Choose a short emoji or icon.";
        if (string.IsNullOrWhiteSpace(input.RestaurantId)) return "Choose a restaurant.";
        return null;
    }

    public static string? ValidateRestaurant(RestaurantInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 80) return "Restaurant name must be 1 to 80 characters.";
        if (string.IsNullOrWhiteSpace(input.Cuisine) || input.Cuisine.Length > 60) return "Cuisine must be 1 to 60 characters.";
        if (string.IsNullOrWhiteSpace(input.Tagline) || input.Tagline.Length > 160) return "Tagline must be 1 to 160 characters.";
        if (input.PrepMinutes is < 5 or > 120) return "Prep time must be between 5 and 120 minutes.";
        if (input.ImageKey is not ("burger" or "pizza" or "bowl" or "wings")) return "Choose a restaurant image.";
        if (input.Accent is not ("coral" or "olive" or "gold" or "plum")) return "Choose an accent color.";
        return null;
    }

    public static bool CanTransition(Order order, string next) => order.Status switch
    {
        "Placed" => next is "Preparing" or "Cancelled",
        "Preparing" => next is "Ready" or "Cancelled",
        "Ready" when order.Fulfillment == "delivery" => next is "Out for delivery" or "Cancelled",
        "Ready" => next is "Completed" or "Cancelled",
        "Out for delivery" => next is "Completed" or "Cancelled",
        _ => false
    };

    public static IReadOnlyList<string> NextStatuses(Order order) => order.Status switch
    {
        "Placed" => ["Preparing", "Cancelled"],
        "Preparing" => ["Ready", "Cancelled"],
        "Ready" when order.Fulfillment == "delivery" => ["Out for delivery", "Cancelled"],
        "Ready" => ["Completed", "Cancelled"],
        "Out for delivery" => ["Completed", "Cancelled"],
        _ => []
    };
}

public static class SeedMenu
{
    public static List<MenuItem> Create() =>
    [
        new("burger-classic", "The Classic", "Burgers", "Double smashed beef, cheddar, pickles, house sauce.", 12.50m, "🍔", "peach", true),
        new("burger-spicy", "Hot Honey Crunch", "Burgers", "Crispy chicken, hot honey glaze, slaw, ranch.", 13.75m, "🍗", "rose", true),
        new("burger-veggie", "Garden Burger", "Burgers", "Chickpea patty, avocado, tomato, green goddess.", 12.00m, "🥑", "mint"),
        new("pizza-margherita", "Margherita", "Pizza", "Tomato, fresh mozzarella, basil, olive oil.", 16.00m, "🍕", "peach", true),
        new("pizza-pepperoni", "Pepperoni Heat", "Pizza", "Mozzarella, spicy pepperoni, chili honey.", 18.50m, "🍕", "rose"),
        new("bowl-grain", "Glow Bowl", "Bowls", "Warm grains, roasted vegetables, feta, lemon tahini.", 14.25m, "🥗", "mint"),
        new("bowl-chicken", "Chicken Power Bowl", "Bowls", "Herb chicken, rice, greens, avocado, citrus dressing.", 15.50m, "🥙", "lemon"),
        new("side-fries", "Truffle Fries", "Sides", "Crispy shoestring fries, parmesan, truffle seasoning.", 6.50m, "🍟", "lemon", true),
        new("side-wings", "Sticky Wings", "Sides", "Six wings tossed in our smoky sweet glaze.", 9.75m, "🍗", "rose"),
        new("drink-lemonade", "House Lemonade", "Drinks", "Fresh-squeezed lemons, a little sparkle.", 4.50m, "🍋", "lemon"),
        new("drink-cola", "Craft Cola", "Drinks", "Chilled small-batch cola.", 3.75m, "🥤", "peach"),
        new("dessert-cookie", "Warm Choc Cookie", "Desserts", "Soft-centered chocolate chunk cookie.", 5.25m, "🍪", "peach")
    ];

    public static List<MenuItem> CreateAdditional() =>
    [
        new("ember-margherita", "Basil Margherita", "Pizza", "Slow tomato, fresh mozzarella, basil and olive oil.", 17.00m, "🍕", "peach", true, true, "ember-pizza"),
        new("ember-pepperoni", "Hot Honey Pepperoni", "Pizza", "Crisp pepperoni, chili honey and aged mozzarella.", 19.50m, "🍕", "rose", true, true, "ember-pizza"),
        new("ember-garlic", "Garlic Knots", "Sides", "Baked knots with roasted garlic butter and parmesan.", 7.50m, "🥖", "lemon", false, true, "ember-pizza"),
        new("ember-cookie", "Skillet Cookie", "Desserts", "Warm chocolate cookie with a soft center.", 6.50m, "🍪", "peach", false, true, "ember-pizza"),
        new("green-grain", "The Green Goddess", "Bowls", "Grains, avocado, cucumber, herbs and green tahini.", 14.50m, "🥗", "mint", true, true, "green-table"),
        new("green-chicken", "Citrus Chicken Bowl", "Bowls", "Herb chicken, rice, pickled cabbage and lemon dressing.", 16.00m, "🥙", "lemon", true, true, "green-table"),
        new("green-veggie", "Roasted Harvest Bowl", "Bowls", "Warm sweet potato, chickpeas, kale and feta.", 14.75m, "🥗", "mint", false, true, "green-table"),
        new("green-lemonade", "Mint Lemonade", "Drinks", "Fresh lemon, mint and a little sparkle.", 4.75m, "🍋", "lemon", false, true, "green-table")
    ];
}

public static class SeedRestaurants
{
    public static List<Restaurant> Create() =>
    [
        new("fork-flame", "Fork & Flame", "Burgers · Comfort food", "Big flavor, made for every craving.", 25, "burger", "coral"),
        new("ember-pizza", "Ember Pizza Co.", "Wood-fired pizza", "A little char. A lot of love.", 30, "pizza", "gold"),
        new("green-table", "The Green Table", "Bowls · Fresh food", "Bright bowls for feel-good days.", 20, "bowl", "olive")
    ];
}
