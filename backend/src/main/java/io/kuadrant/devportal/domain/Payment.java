package io.kuadrant.devportal.domain;

import java.time.Instant;
import java.util.List;

import io.kuadrant.devportal.domain.Enums.PaymentKind;
import io.kuadrant.devportal.domain.Enums.PaymentStatus;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

/**
 * One billing charge against the payment gateway (NMI) — the portal's invoice
 * ledger line. Created PENDING, then stamped with the gateway result
 * ({@link #status}, {@link #gatewayTransactionId}, {@link #gatewayMessage}).
 * Never stores a PAN: only the gateway's masked {@link #cardLast4}/{@link #cardBrand}.
 */
@Entity
@Table(name = "payment")
public class Payment extends PanacheEntity {

    @Column(nullable = false)
    public Long userId;

    /** Subscription this charge activates / renews. Null for an ad-hoc charge. */
    public Long subscriptionId;

    public Long applicationPlanId;

    @Column(nullable = false)
    public long amountCents;

    @Column(nullable = false, length = 3)
    public String currency = "USD";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public PaymentStatus status = PaymentStatus.PENDING;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public PaymentKind kind = PaymentKind.SUBSCRIPTION;

    /** NMI {@code transactionid}. */
    public String gatewayTransactionId;

    /** NMI {@code authcode}. */
    public String gatewayAuthCode;

    /** NMI {@code responsetext} (human-readable approve/decline reason). */
    @Column(length = 500)
    public String gatewayMessage;

    public String cardLast4;

    public String cardBrand;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    public static List<Payment> listForUser(Long userId) {
        return list("userId = ?1 order by createdAt desc", userId);
    }

    public static List<Payment> listForSubscription(Long subscriptionId) {
        return list("subscriptionId = ?1 order by createdAt desc", subscriptionId);
    }
}
