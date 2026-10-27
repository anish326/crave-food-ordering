using System.Text.Json;

public sealed class AppStore
{
    private readonly string? _path;
    private readonly CloudDocuments _cloud;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private AppState _state = new();

    public AppStore(IWebHostEnvironment environment, CloudDocuments cloud)
    {
        _cloud = cloud;
        if (cloud.Enabled) return;
        var directory = Path.Combine(environment.ContentRootPath, "App_Data");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "state.json");
        if (File.Exists(_path))
        {
            _state = JsonSerializer.Deserialize<AppState>(File.ReadAllText(_path), _json)
                ?? throw new InvalidDataException("The application data file is empty.");
            if (_state.Restaurants.Count == 0)
            {
                _state.Restaurants = SeedRestaurants.Create();
                _state.Menu.AddRange(SeedMenu.CreateAdditional().Where(item => _state.Menu.All(existing => existing.Id != item.Id)));
                File.WriteAllText(_path, JsonSerializer.Serialize(_state, _json));
            }
        }
        else
        {
            var oldOrdersPath = Path.Combine(directory, "orders.json");
            var oldOrders = File.Exists(oldOrdersPath) ? JsonSerializer.Deserialize<List<Order>>(File.ReadAllText(oldOrdersPath), _json) ?? [] : [];
            _state = Seed(); _state.Orders = oldOrders;
            File.WriteAllText(_path, JsonSerializer.Serialize(_state, _json));
        }
    }

    private static AppState Seed() => new() { Menu = [.. SeedMenu.Create(), .. SeedMenu.CreateAdditional()], Restaurants = SeedRestaurants.Create() };

    private async Task<CloudDocument<AppState>> LoadCloudAsync()
    {
        for (var attempt = 0; attempt < 12; attempt++)
        {
            var document = await _cloud.ReadAsync<AppState>("app-state.json");
            if (document is not null) return document;
            await _cloud.TryWriteAsync("app-state.json", Seed(), null);
        }
        throw new IOException("Order storage is busy. Please try again.");
    }

    public async Task<T> ReadAsync<T>(Func<AppState, T> read)
    {
        await _gate.WaitAsync();
        try { return read(_cloud.Enabled ? (await LoadCloudAsync()).Value : _state); }
        finally { _gate.Release(); }
    }

    public async Task<T> WriteAsync<T>(Func<AppState, T> write)
    {
        await _gate.WaitAsync();
        try
        {
            if (_cloud.Enabled)
            {
                for (var attempt = 0; attempt < 12; attempt++)
                {
                    var document = await LoadCloudAsync();
                    var result = write(document.Value);
                    if (await _cloud.TryWriteAsync("app-state.json", document.Value, document.ETag)) return result;
                }
                throw new IOException("Order storage is busy. Please retry your request.");
            }
            var working = new AppState { Menu = [.. _state.Menu], Orders = [.. _state.Orders], Restaurants = [.. _state.Restaurants] };
            var localResult = write(working);
            var temp = _path + ".tmp";
            await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(working, _json));
            File.Move(temp, _path!, true);
            _state = working;
            return localResult;
        }
        finally { _gate.Release(); }
    }
}
