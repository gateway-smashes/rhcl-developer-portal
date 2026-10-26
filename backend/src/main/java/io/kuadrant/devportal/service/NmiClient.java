package io.kuadrant.devportal.service;

import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import jakarta.enterprise.context.ApplicationScoped;

/**
 * Thin client for the NMI (Network Merchants) Payment API — the classic
 * Direct-Post {@code transact.php} endpoint. Form-url-encodes the request and
 * parses NMI's url-encoded response. Driven by {@code portal.billing.mode}:
 * <ul>
 *   <li>{@code nmi}  — real calls to the configured endpoint + security key.</li>
 *   <li>{@code mock} — no network; deterministic approval (a token containing
 *       "decline" is declined) so the whole flow is demoable offline.</li>
 * </ul>
 * No PAN ever reaches this client: the browser tokenizes the card with
 * Collect.js and we only ever handle the opaque {@code payment_token} /
 * {@code customer_vault_id}.
 */
@ApplicationScoped
public class NmiClient {

    private static final Logger LOG = Logger.getLogger(NmiClient.class);

    @ConfigProperty(name = "portal.billing.mode", defaultValue = "mock")
    String mode;

    @ConfigProperty(name = "portal.billing.nmi.endpoint", defaultValue = "https://secure.nmi.com/api/transact.php")
    String endpoint;

    // Optional: unset in mock mode (an empty String value fails SmallRye's
    // String conversion, so we inject Optional and fall back to "").
    @ConfigProperty(name = "portal.billing.nmi.security-key")
    Optional<String> securityKeyCfg;

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private String securityKey() {
        return securityKeyCfg.filter(s -> !s.isBlank()).orElse("");
    }

    public boolean mockMode() {
        return !"nmi".equalsIgnoreCase(mode);
    }

    /** A {@code type=sale} using a Collect.js payment token. */
    public NmiResult sale(long amountCents, String paymentToken) {
        Map<String, String> p = base("sale", amountCents);
        p.put("payment_token", paymentToken);
        return transact(p, paymentToken);
    }

    /** A {@code type=sale} against a stored Customer Vault id (recurring). */
    public NmiResult saleWithVault(long amountCents, String vaultId) {
        Map<String, String> p = base("sale", amountCents);
        p.put("customer_vault_id", vaultId);
        return transact(p, vaultId);
    }

    /** Add a card to the Customer Vault; returns the new vault id. */
    public NmiVaultResult addToVault(String paymentToken) {
        if (mockMode()) {
            return new NmiVaultResult(true, "MOCK-VAULT-" + Long.toHexString(System.nanoTime()), "mock vault add");
        }
        Map<String, String> p = new LinkedHashMap<>();
        p.put("security_key", securityKey());
        p.put("customer_vault", "add_customer");
        p.put("payment_token", paymentToken);
        Map<String, String> r = post(p);
        boolean ok = "1".equals(r.get("response"));
        return new NmiVaultResult(ok, r.get("customer_vault_id"), r.getOrDefault("responsetext", ""));
    }

    private Map<String, String> base(String type, long amountCents) {
        Map<String, String> p = new LinkedHashMap<>();
        p.put("security_key", securityKey());
        p.put("type", type);
        p.put("amount", amount(amountCents));
        return p;
    }

    private NmiResult transact(Map<String, String> params, String tokenForMock) {
        if (mockMode()) {
            boolean declined = tokenForMock != null && tokenForMock.toLowerCase().contains("decline");
            return new NmiResult(declined ? "2" : "1",
                    declined ? "DECLINE (mock gateway)" : "SUCCESS (mock gateway)",
                    "MOCK-" + Long.toHexString(System.nanoTime()),
                    declined ? null : "MOCK00", "mock");
        }
        Map<String, String> r = post(params);
        return new NmiResult(r.getOrDefault("response", "3"), r.getOrDefault("responsetext", ""),
                r.get("transactionid"), r.get("authcode"), r.toString());
    }

    private Map<String, String> post(Map<String, String> params) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(20))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(encode(params))).build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            return parse(res.body());
        } catch (Exception e) {
            LOG.errorf(e, "NMI call failed");
            return Map.of("response", "3", "responsetext", "gateway unreachable: " + e.getMessage());
        }
    }

    /** NMI wants the amount as decimal dollars, e.g. 4900 cents → "49.00". */
    private static String amount(long cents) {
        return (cents / 100) + "." + String.format("%02d", Math.abs(cents % 100));
    }

    private static String encode(Map<String, String> params) {
        StringBuilder sb = new StringBuilder();
        for (var e : params.entrySet()) {
            if (e.getValue() == null) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append('&');
            }
            sb.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)).append('=')
                    .append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    private static Map<String, String> parse(String body) {
        Map<String, String> m = new LinkedHashMap<>();
        if (body == null || body.isBlank()) {
            return m;
        }
        for (String pair : body.split("&")) {
            int i = pair.indexOf('=');
            if (i < 0) {
                m.put(dec(pair), "");
            } else {
                m.put(dec(pair.substring(0, i)), dec(pair.substring(i + 1)));
            }
        }
        return m;
    }

    private static String dec(String s) {
        return URLDecoder.decode(s, StandardCharsets.UTF_8);
    }

    /**
     * {@code response}: "1" approved, "2" declined, "3" error (gateway reject).
     */
    public record NmiResult(String responseCode, String responseText, String transactionId, String authCode,
            String raw) {
        public boolean approved() {
            return "1".equals(responseCode);
        }

        public boolean declined() {
            return "2".equals(responseCode);
        }
    }

    public record NmiVaultResult(boolean success, String vaultId, String responseText) {
    }
}
