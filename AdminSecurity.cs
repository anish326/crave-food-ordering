using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public record PasswordChange(string? CurrentPassword, string? NewPassword);
public record LoginInput(string? Password);
internal record PasswordFile(string Salt, string Hash, string Stamp);

public sealed class AdminCredentials
{
    private readonly string? _path;
    private readonly CloudDocuments _cloud;
    private readonly object _lock = new();
    private PasswordFile _stored;
    private string? _etag;
    public string Stamp { get { lock (_lock) { Reload(); return _stored.Stamp; } } }

    public AdminCredentials(IWebHostEnvironment environment, CloudDocuments cloud)
    {
        _cloud = cloud;
        if (!cloud.Enabled)
        {
            var directory = Path.Combine(environment.ContentRootPath, "App_Data"); Directory.CreateDirectory(directory);
            _path = Path.Combine(directory, "admin.json");
            if (File.Exists(_path))
            {
                _stored = JsonSerializer.Deserialize<PasswordFile>(File.ReadAllText(_path)) ?? throw new InvalidDataException("Invalid staff credentials.");
                return;
            }
        }
        else
        {
            var existing = cloud.ReadAsync<PasswordFile>("admin.json").GetAwaiter().GetResult();
            if (existing is not null) { _stored = existing.Value; _etag = existing.ETag; return; }
        }
        var configured = Environment.GetEnvironmentVariable("FOODORDER_ADMIN_PASSWORD");
        if (cloud.Enabled && string.IsNullOrWhiteSpace(configured))
            throw new InvalidOperationException("Set FOODORDER_ADMIN_PASSWORD before deploying the staff dashboard.");
        var password = configured ?? Convert.ToHexString(RandomNumberGenerator.GetBytes(12));
        if (password.Length is < 12 or > 128) throw new InvalidOperationException("Staff password must contain 12 to 128 characters.");
        _stored = Hash(password);
        if (cloud.Enabled)
        {
            cloud.TryWriteAsync("admin.json", _stored, null).GetAwaiter().GetResult();
            Reload();
        }
        else SaveLocal(_stored);
        if (configured is null) Console.WriteLine($"Crave first-run staff password: {password}\nStaff dashboard: http://localhost:5000/admin.html");
    }

    private void Reload()
    {
        if (!_cloud.Enabled) return;
        var document = _cloud.ReadAsync<PasswordFile>("admin.json").GetAwaiter().GetResult() ?? throw new InvalidDataException("Staff credentials are missing.");
        _stored = document.Value; _etag = document.ETag;
    }

    public bool Verify(string? password)
    {
        if (string.IsNullOrEmpty(password) || password.Length > 128) return false;
        lock (_lock) { Reload(); return VerifyHash(_stored, password); }
    }

    private static bool VerifyHash(PasswordFile stored, string? password)
    {
        if (string.IsNullOrEmpty(password)) return false;
        var salt = Convert.FromBase64String(stored.Salt); var expected = Convert.FromBase64String(stored.Hash);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, 150_000, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    public bool Change(string? current, string? next)
    {
        if (string.IsNullOrWhiteSpace(next) || next.Length is < 12 or > 128) return false;
        lock (_lock)
        {
            Reload();
            if (!VerifyHash(_stored, current)) return false;
            var updated = Hash(next);
            if (_cloud.Enabled && !_cloud.TryWriteAsync("admin.json", updated, _etag).GetAwaiter().GetResult()) return false;
            if (!_cloud.Enabled) SaveLocal(updated);
            _stored = updated;
            return true;
        }
    }

    public void Reset()
    {
        var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(12));
        lock (_lock)
        {
            Reload(); var updated = Hash(password);
            if (_cloud.Enabled && !_cloud.TryWriteAsync("admin.json", updated, _etag).GetAwaiter().GetResult()) throw new IOException("Credentials changed concurrently. Retry the reset.");
            if (!_cloud.Enabled) SaveLocal(updated);
            _stored = updated;
        }
        Console.WriteLine($"New staff password: {password}");
    }

    private static PasswordFile Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16); var bytes = Rfc2898DeriveBytes.Pbkdf2(password, salt, 150_000, HashAlgorithmName.SHA256, 32);
        return new(Convert.ToBase64String(salt), Convert.ToBase64String(bytes), Convert.ToHexString(RandomNumberGenerator.GetBytes(16)));
    }
    private void SaveLocal(PasswordFile value) { var temp = _path + ".tmp"; File.WriteAllText(temp, JsonSerializer.Serialize(value)); File.Move(temp, _path!, true); }
}

public record LoginAttempt(int Failures, DateTimeOffset Until);
public sealed class LoginGuard(CloudDocuments documents)
{
    private readonly ConcurrentDictionary<string, LoginAttempt> _attempts = new();
    private static string PathFor(string key) => "login-guard/" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))) + ".json";
    public bool CanTry(string key)
    {
        var attempt = documents.Enabled ? documents.ReadAsync<LoginAttempt>(PathFor(key)).GetAwaiter().GetResult()?.Value : _attempts.GetValueOrDefault(key);
        return attempt is null || DateTimeOffset.UtcNow > attempt.Until || attempt.Failures < 8;
    }
    private void Update(string key, bool reset)
    {
        if (!documents.Enabled)
        {
            if (reset) { _attempts.TryRemove(key, out _); return; }
            _attempts.AddOrUpdate(key, _ => new(1, DateTimeOffset.UtcNow.AddMinutes(15)), (_, old) => DateTimeOffset.UtcNow > old.Until ? new(1, DateTimeOffset.UtcNow.AddMinutes(15)) : old with { Failures = old.Failures + 1 });
            return;
        }
        for (var retry = 0; retry < 12; retry++)
        {
            var document = documents.ReadAsync<LoginAttempt>(PathFor(key)).GetAwaiter().GetResult();
            var old = document?.Value;
            var updated = reset ? new LoginAttempt(0, DateTimeOffset.UtcNow) : old is null || DateTimeOffset.UtcNow > old.Until ? new(1, DateTimeOffset.UtcNow.AddMinutes(15)) : old with { Failures = old.Failures + 1 };
            if (documents.TryWriteAsync(PathFor(key), updated, document?.ETag).GetAwaiter().GetResult()) return;
        }
        throw new IOException("Login protection is busy. Try again.");
    }
    public void Fail(string key) => Update(key, false);
    public void Succeed(string key) => Update(key, true);
}
