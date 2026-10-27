using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection.Repositories;

public record CloudDocument<T>(T Value, string ETag);

/// <summary>Private Vercel Blob documents with strongly consistent reads and conditional writes.</summary>
public sealed class CloudDocuments
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _http;
    private readonly string _storeId;
    private readonly string _token;
    private readonly string _prefix;
    public bool Enabled { get; }

    public CloudDocuments() : this(new HttpClient { Timeout = TimeSpan.FromSeconds(20) },
        Environment.GetEnvironmentVariable("BLOB_STORE_ID") ?? "",
        Environment.GetEnvironmentVariable("BLOB_READ_WRITE_TOKEN") ?? "",
        Environment.GetEnvironmentVariable("FOODORDER_BLOB_PREFIX") ?? "crave/" + (Environment.GetEnvironmentVariable("VERCEL_ENV") ?? "development"),
        Environment.GetEnvironmentVariable("FOODORDER_STORAGE") == "vercel-blob") { }

    public CloudDocuments(HttpClient http, string storeId, string token, string prefix, bool enabled = true)
    {
        _http = http; _token = token; _prefix = prefix.Trim('/'); Enabled = enabled;
        _storeId = string.IsNullOrWhiteSpace(storeId) ? token.Split('_').ElementAtOrDefault(3) ?? "" : storeId;
        if (Enabled && (string.IsNullOrWhiteSpace(_token) || string.IsNullOrWhiteSpace(_storeId) ||
            _storeId.Any(character => !char.IsAsciiLetterOrDigit(character))))
            throw new InvalidOperationException("Configure a private Blob store and BLOB_READ_WRITE_TOKEN before starting cloud storage.");
        if (!Enabled && Environment.GetEnvironmentVariable("VERCEL") == "1")
            throw new InvalidOperationException("Vercel deployments require FOODORDER_STORAGE=vercel-blob. Local files are not durable on Vercel.");
    }

    public async Task<CloudDocument<T>?> ReadAsync<T>(string name)
    {
        var pathname = _prefix + "/" + name;
        var path = string.Join('/', pathname.Split('/').Select(Uri.EscapeDataString));
        using var request = new HttpRequestMessage(HttpMethod.Get, $"https://{_storeId}.private.blob.vercel-storage.com/{path}?cache=0");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        using var response = await _http.SendAsync(request);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        EnsureSuccess(response);
        var value = JsonSerializer.Deserialize<T>(await response.Content.ReadAsStringAsync(), Json)
            ?? throw new InvalidDataException("Persistent document is empty.");
        var etag = response.Headers.ETag?.ToString();
        if (string.IsNullOrWhiteSpace(etag)) throw new InvalidDataException("Persistent document has no version tag.");
        return new(value, etag);
    }

    public async Task<bool> TryWriteAsync<T>(string name, T value, string? expectedETag)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, "https://vercel.com/api/blob/?pathname=" + Uri.EscapeDataString(_prefix + "/" + name));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        request.Headers.TryAddWithoutValidation("x-api-version", "13");
        request.Headers.TryAddWithoutValidation("x-vercel-blob-store-id", _storeId);
        request.Headers.TryAddWithoutValidation("x-vercel-blob-access", "private");
        request.Headers.TryAddWithoutValidation("x-add-random-suffix", "0");
        request.Headers.TryAddWithoutValidation("x-allow-overwrite", expectedETag is null ? "0" : "1");
        request.Headers.TryAddWithoutValidation("x-content-type", "application/json");
        if (expectedETag is not null) request.Headers.TryAddWithoutValidation("x-if-match", expectedETag);
        request.Content = new StringContent(JsonSerializer.Serialize(value, Json), Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request);
        if (response.StatusCode == HttpStatusCode.PreconditionFailed || response.StatusCode == HttpStatusCode.Conflict) return false;
        EnsureSuccess(response);
        return true;
    }

    private static void EnsureSuccess(HttpResponseMessage response)
    {
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Persistent storage returned HTTP {(int)response.StatusCode}.", null, response.StatusCode);
    }
}

public sealed class BlobKeyRepository(CloudDocuments documents) : IXmlRepository
{
    public IReadOnlyCollection<XElement> GetAllElements() =>
        (documents.ReadAsync<List<string>>("session-keys.json").GetAwaiter().GetResult()?.Value ?? [])
        .Select(value => XElement.Parse(value)).ToList().AsReadOnly();

    public void StoreElement(XElement element, string friendlyName)
    {
        for (var attempt = 0; attempt < 12; attempt++)
        {
            var stored = documents.ReadAsync<List<string>>("session-keys.json").GetAwaiter().GetResult();
            var keys = stored?.Value ?? [];
            var xml = element.ToString(SaveOptions.DisableFormatting);
            if (!keys.Contains(xml)) keys.Add(xml);
            if (documents.TryWriteAsync("session-keys.json", keys, stored?.ETag).GetAwaiter().GetResult()) return;
        }
        throw new IOException("Session key storage is busy. Try again.");
    }
}
