package io.kuadrant.devportal.domain;

import java.time.Instant;
import java.util.List;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * A card the consumer saved for recurring billing, stored in the NMI
 * <em>Customer Vault</em>. The portal only keeps the opaque {@link #vaultId}
 * plus the masked card details the gateway returns — never the PAN. Recurring
 * charges reference {@link #vaultId} instead of re-collecting the card.
 */
@Entity
@Table(name = "payment_method")
public class PaymentMethod extends PanacheEntity {

    @Column(nullable = false)
    public Long userId;

    /** NMI {@code customer_vault_id}. */
    @Column(nullable = false)
    public String vaultId;

    public String cardLast4;

    public String cardBrand;

    /** MM, as returned by the gateway. */
    public String expMonth;

    /** YYYY, as returned by the gateway. */
    public String expYear;

    @Column(nullable = false)
    public boolean isDefault = true;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    public static PaymentMethod defaultForUser(Long userId) {
        return find("userId = ?1 and isDefault = true", userId).firstResult();
    }

    public static List<PaymentMethod> listForUser(Long userId) {
        return list("userId = ?1 order by createdAt desc", userId);
    }
}
