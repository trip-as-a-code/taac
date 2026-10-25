//! Who paid what, who owes whom — per currency, with no exchange rates.
//! A cost settles in the currency actually charged when it is known, else
//! in the currency it is quoted in. Converting between currencies is the
//! viewer's business (the website uses live ECB rates).

use indexmap::IndexMap;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};
use serde::Serialize;

use crate::loader::Trip;
use crate::model::{BookingStatus, Cost, Item, Split};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    /// The trip's default display currency.
    pub base: String,
    pub lines: Vec<CostLine>,
    /// Estimated costs of ideas: possible spend, never planned.
    pub ideas: Vec<CostLine>,
    /// Totals, balances and settlements in each currency money moved in.
    pub by_currency: IndexMap<String, CurrencyBudget>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[expect(
    clippy::struct_excessive_bools,
    reason = "flags in the JSON the site reads"
)]
pub struct CostLine {
    /// Item, idea or packing item id.
    pub item: String,
    /// Set for packing purchases, which have no itinerary item to name them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// An idea's option group: only the cheapest alternative counts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub option: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub kind: String,
    /// The price as quoted.
    #[serde(with = "rust_decimal::serde::float")]
    pub amount: Decimal,
    pub currency: String,
    /// What was actually charged, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charged: Option<MoneyExport>,
    /// The amount balances use: `charged` if known, else the price.
    #[serde(with = "rust_decimal::serde::float")]
    pub settled_amount: Decimal,
    pub settled_currency: String,
    pub committed: bool,
    pub estimate: bool,
    /// Nobody has paid yet: `paid` is empty, nothing is owed.
    pub unpaid: bool,
    /// Nobody owes anybody for it: unpaid, paid by `each`, or paid back.
    pub settled: bool,
    /// Fraction of the cost each member bears (sums to 1).
    pub shares: IndexMap<String, f64>,
    /// Fraction of the cost each member paid (sums to 1).
    pub paid: IndexMap<String, f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoneyExport {
    #[serde(with = "rust_decimal::serde::float")]
    pub amount: Decimal,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyBudget {
    pub total: Amounts,
    pub members: Vec<MemberBalance>,
    /// Transfers that settle this currency, planned spend included.
    pub settlements: Vec<Settlement>,
}

/// `committed` counts only booked items; `planned` everything not cancelled.
#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Amounts {
    #[serde(with = "rust_decimal::serde::float")]
    pub planned: Decimal,
    #[serde(with = "rust_decimal::serde::float")]
    pub committed: Decimal,
}

impl Amounts {
    fn add(&mut self, amount: Decimal, committed: bool) {
        self.planned += amount;
        if committed {
            self.committed += amount;
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberBalance {
    pub member: String,
    pub paid: Amounts,
    pub share: Amounts,
    /// What was paid minus their share, over costs not yet paid back:
    /// positive is owed money, negative owes.
    #[serde(with = "rust_decimal::serde::float")]
    pub balance: Decimal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settlement {
    pub from: String,
    pub to: String,
    #[serde(with = "rust_decimal::serde::float")]
    pub amount: Decimal,
}

pub fn round(amount: Decimal) -> Decimal {
    amount.round_dp_with_strategy(2, RoundingStrategy::MidpointNearestEven)
}

pub fn is_committed(item: &Item) -> bool {
    item.booking
        .as_ref()
        .is_some_and(|b| b.status == BookingStatus::Booked)
}

fn is_cancelled(item: &Item) -> bool {
    item.booking
        .as_ref()
        .is_some_and(|b| b.status == BookingStatus::Cancelled)
}

/// Splits `amount` per the rule, in cents, so shares always sum exactly.
pub fn shares(
    amount: Decimal,
    split: &Split,
    paid_by: &str,
    participants: &[&str],
) -> IndexMap<String, Decimal> {
    let weights: Vec<(String, Decimal)> = match split {
        Split::Personal => vec![(paid_by.to_owned(), Decimal::ONE)],
        Split::Equal if participants.is_empty() => vec![(paid_by.to_owned(), Decimal::ONE)],
        Split::Equal => participants
            .iter()
            .map(|m| ((*m).to_owned(), Decimal::ONE))
            .collect(),
        Split::Shares(map) | Split::Exact(map) => {
            map.iter().map(|(m, w)| (m.clone(), *w)).collect()
        }
    };
    distribute(amount, &weights, paid_by)
}

/// Divides `amount` by weight, rounding to cents and handing out the
/// leftover cents first-come, so the parts always add up.
fn distribute(
    amount: Decimal,
    weights: &[(String, Decimal)],
    fallback: &str,
) -> IndexMap<String, Decimal> {
    let total_weight: Decimal = weights.iter().map(|(_, w)| *w).sum();
    let mut out = IndexMap::new();
    if total_weight <= Decimal::ZERO {
        out.insert(fallback.to_owned(), round(amount));
        return out;
    }
    let target = round(amount);
    let mut allocated = Decimal::ZERO;
    for (member, weight) in weights {
        let share =
            (amount * weight / total_weight).round_dp_with_strategy(2, RoundingStrategy::ToZero);
        allocated += share;
        *out.entry(member.clone()).or_insert(Decimal::ZERO) += share;
    }
    let cent = Decimal::new(1, 2);
    let mut remainder = target - allocated;
    let members: Vec<String> = out.keys().cloned().collect();
    let mut i = 0;
    while remainder >= cent && !members.is_empty() {
        *out.get_mut(&members[i % members.len()]).expect("present") += cent;
        remainder -= cent;
        i += 1;
    }
    out
}

/// One cost's settled amount split into who bears it and who paid it.
struct Allocation {
    settled_amount: Decimal,
    settled_currency: String,
    shares: IndexMap<String, Decimal>,
    paid: IndexMap<String, Decimal>,
}

fn allocate(trip: &Trip, cost: &Cost, participants: &[&str]) -> Allocation {
    let (settled_amount, settled_currency) = cost.charged.as_ref().map_or_else(
        || (cost.amount, cost.currency.clone()),
        |c| (c.amount, c.currency.clone()),
    );
    let beneficiaries = cost
        .who
        .as_deref()
        .map_or_else(|| participants.to_vec(), |who| trip.who(Some(who)));
    let payers: Vec<String> = trip
        .who(Some(&cost.payers()))
        .into_iter()
        .map(str::to_owned)
        .collect();
    let first_payer = payers.first().map_or("", String::as_str);
    let split = match &cost.split {
        // Exact amounts are quoted prices; applied to the charged amount
        // they act as weights.
        Split::Exact(map) => Split::Shares(map.clone()),
        other => other.clone(),
    };
    let personal_owner = if cost.is_each() || payers.is_empty() {
        beneficiaries.first().copied().unwrap_or_default()
    } else {
        first_payer
    };
    let shares = shares(settled_amount, &split, personal_owner, &beneficiaries);
    let paid = if cost.is_each() {
        shares.clone()
    } else if !cost.is_paid() {
        IndexMap::new()
    } else {
        let weights: Vec<(String, Decimal)> =
            payers.iter().map(|p| (p.clone(), Decimal::ONE)).collect();
        distribute(settled_amount, &weights, first_payer)
    };
    Allocation {
        settled_amount: round(settled_amount),
        settled_currency,
        shares,
        paid,
    }
}

fn fractions(parts: &IndexMap<String, Decimal>, total: Decimal) -> IndexMap<String, f64> {
    parts
        .iter()
        .map(|(m, v)| {
            let fraction = if total > Decimal::ZERO {
                *v / total
            } else {
                Decimal::ZERO
            };
            (m.clone(), fraction.round_dp(8).to_f64().unwrap_or_default())
        })
        .collect()
}

fn line(
    trip: &Trip,
    id: &str,
    kind: &str,
    cost: &Cost,
    participants: &[&str],
    committed: bool,
) -> (CostLine, Allocation) {
    let allocation = allocate(trip, cost, participants);
    let line = CostLine {
        item: id.to_owned(),
        title: None,
        option: None,
        label: cost.label.clone(),
        kind: kind.to_owned(),
        amount: cost.amount,
        currency: cost.currency.clone(),
        charged: cost.charged.as_ref().map(|c| MoneyExport {
            amount: c.amount,
            currency: c.currency.clone(),
        }),
        settled_amount: allocation.settled_amount,
        settled_currency: allocation.settled_currency.clone(),
        committed,
        estimate: cost.estimate,
        unpaid: !cost.is_paid(),
        settled: !cost.owed(),
        shares: fractions(&allocation.shares, allocation.settled_amount),
        paid: fractions(&allocation.paid, allocation.settled_amount),
    };
    (line, allocation)
}

impl Budget {
    fn add(&mut self, trip: &Trip, line: CostLine, allocation: &Allocation) {
        let committed = line.committed;
        let currency = self
            .by_currency
            .entry(allocation.settled_currency.clone())
            .or_insert_with(|| CurrencyBudget {
                total: Amounts::default(),
                members: trip
                    .members
                    .iter()
                    .map(|m| MemberBalance {
                        member: m.id.clone(),
                        paid: Amounts::default(),
                        share: Amounts::default(),
                        balance: Decimal::ZERO,
                    })
                    .collect(),
                settlements: Vec::new(),
            });
        currency.total.add(allocation.settled_amount, committed);
        for balance in &mut currency.members {
            let paid = allocation
                .paid
                .get(&balance.member)
                .copied()
                .unwrap_or_default();
            let share = allocation
                .shares
                .get(&balance.member)
                .copied()
                .unwrap_or_default();
            balance.paid.add(paid, committed);
            balance.share.add(share, committed);
            // Only what was paid and not yet paid back is owed.
            if !line.settled {
                balance.balance += paid - share;
            }
        }
        self.lines.push(line);
    }
}

pub fn compute(trip: &Trip) -> Budget {
    let mut budget = Budget {
        base: trip.base_currency().to_owned(),
        lines: Vec::new(),
        ideas: Vec::new(),
        by_currency: IndexMap::new(),
    };

    for item in &trip.itinerary {
        if is_cancelled(item) {
            continue;
        }
        // Each reservation counts for its own people, booked or not.
        for part in item.parts() {
            let status = part.booking.as_ref().map(|b| b.status);
            if status == Some(BookingStatus::Cancelled) {
                continue;
            }
            let committed = status == Some(BookingStatus::Booked);
            let participants = part
                .who
                .map_or_else(|| trip.participants(item), |w| trip.who(Some(w)));
            for cost in part.costs {
                let (line, allocation) = line(
                    trip,
                    &item.id,
                    item.kind.as_str(),
                    cost,
                    &participants,
                    committed,
                );
                budget.add(trip, line, &allocation);
            }
        }
    }

    // Bought before the trip, so packed: free ones stay off the books.
    for category in &trip.packing {
        let packers = trip.who(category.who.as_deref());
        for item in &category.items {
            let packers = item
                .who()
                .map_or_else(|| packers.clone(), |who| trip.who(Some(who)));
            let id = crate::export::packing_id(&category.category, item.name());
            for cost in item.costs() {
                let zero = cost.amount.is_zero()
                    && cost.charged.as_ref().is_none_or(|c| c.amount.is_zero());
                if zero {
                    continue;
                }
                let (mut line, allocation) =
                    line(trip, &id, "packing", cost, &packers, item.bought());
                line.title = Some(item.name().to_owned());
                budget.add(trip, line, &allocation);
            }
        }
    }

    for idea in &trip.ideas {
        let participants = trip.who(idea.who.as_deref());
        for cost in &idea.costs {
            let (mut line, _) = line(
                trip,
                &idea.id,
                idea.kind.as_str(),
                cost,
                &participants,
                false,
            );
            line.option.clone_from(&idea.option);
            budget.ideas.push(line);
        }
    }

    for currency in budget.by_currency.values_mut() {
        currency.settlements = settle(&currency.members);
    }
    budget
}

/// Greedy: the largest debtor pays the largest creditor until all are even.
fn settle(balances: &[MemberBalance]) -> Vec<Settlement> {
    let cent = Decimal::new(1, 2);
    let mut creditors: Vec<(String, Decimal)> = balances
        .iter()
        .filter(|b| b.balance > Decimal::ZERO)
        .map(|b| (b.member.clone(), b.balance))
        .collect();
    let mut debtors: Vec<(String, Decimal)> = balances
        .iter()
        .filter(|b| b.balance < Decimal::ZERO)
        .map(|b| (b.member.clone(), -b.balance))
        .collect();
    let mut out = Vec::new();
    loop {
        creditors.sort_by_key(|c| std::cmp::Reverse(c.1));
        debtors.sort_by_key(|d| std::cmp::Reverse(d.1));
        let (Some(c), Some(d)) = (creditors.first_mut(), debtors.first_mut()) else {
            break;
        };
        let amount = c.1.min(d.1);
        if amount < cent {
            break;
        }
        out.push(Settlement {
            from: d.0.clone(),
            to: c.0.clone(),
            amount,
        });
        c.1 -= amount;
        d.1 -= amount;
        creditors.retain(|x| x.1 >= cent);
        debtors.retain(|x| x.1 >= cent);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::loader::{Files, load_standalone_trip};

    fn dec(s: &str) -> Decimal {
        s.parse().unwrap()
    }

    #[test]
    fn equal_split_distributes_cents() {
        let s = shares(dec("10.00"), &Split::Equal, "a", &["a", "b", "c"]);
        assert_eq!(s["a"], dec("3.34"));
        assert_eq!(s["b"], dec("3.33"));
        assert_eq!(s.values().sum::<Decimal>(), dec("10.00"));
    }

    #[test]
    fn personal_goes_to_payer() {
        let s = shares(dec("7"), &Split::Personal, "b", &["a", "b"]);
        assert_eq!(s.len(), 1);
        assert_eq!(s["b"], dec("7"));
    }

    #[test]
    fn settles_minimal_transfers() {
        let mk = |m: &str, bal: Decimal| MemberBalance {
            member: m.into(),
            paid: Amounts::default(),
            share: Amounts::default(),
            balance: bal,
        };
        let s = settle(&[mk("a", dec("30")), mk("b", dec("-20")), mk("c", dec("-10"))]);
        assert_eq!(s.len(), 2);
        assert_eq!(
            (s[0].from.as_str(), s[0].to.as_str(), s[0].amount),
            ("b", "a", dec("20"))
        );
    }

    fn trip(costs: &str) -> Trip {
        let yaml = format!(
            r"
apiVersion: taac/v1alpha4
kind: Trip
metadata: {{ title: T, timezone: UTC }}
currency: {{ base: EUR }}
members: [{{ name: A }}, {{ name: B, currency: USD }}, {{ name: C }}]
itinerary:
  - kind: activity
    title: x
    date: 2027-01-01
    booking: {{ status: booked }}
    costs:
{costs}"
        );
        let files: Files = [("trip.yaml".to_owned(), yaml)].into();
        load_standalone_trip(&files, "trip.yaml")
            .0
            .unwrap()
            .trips
            .remove(0)
    }

    #[test]
    fn charged_amount_settles_in_its_own_currency() {
        let b = compute(&trip(
            "      - { amount: 30000, currency: JPY, paidBy: b, charged: { amount: 201, currency: USD }, settled: false }",
        ));
        assert_eq!(b.lines[0].settled_currency, "USD");
        let usd = &b.by_currency["USD"];
        assert_eq!(usd.total.committed, dec("201"));
        assert_eq!(usd.settlements.len(), 2);
        assert!(!b.by_currency.contains_key("JPY"));
    }

    #[test]
    fn each_pays_their_own_share_and_owes_nothing() {
        let b = compute(&trip("      - { amount: 90, currency: EUR, paidBy: each }"));
        assert!(b.by_currency["EUR"].settlements.is_empty());
        assert!((b.lines[0].paid["a"] - 1.0 / 3.0).abs() < 1e-6);
    }

    #[test]
    fn several_payers_and_a_narrower_who() {
        let b = compute(&trip(
            "      - { amount: 100, currency: EUR, paidBy: [a, b], who: [c], settled: false }",
        ));
        let eur = &b.by_currency["EUR"];
        let balance = |m: &str| eur.members.iter().find(|x| x.member == m).unwrap().balance;
        assert_eq!(
            (balance("a"), balance("b"), balance("c")),
            (dec("50"), dec("50"), dec("-100"))
        );
    }

    #[test]
    fn packing_purchases_count_and_free_ones_do_not() {
        let b = compute(&trip(
            r"      - { amount: 30, currency: EUR, paidBy: a }
packing:
  - category: Gear
    who: [a, c]
    items:
      - Socks
      - name: Adapter
        bought: true
        costs: [{ amount: 12, currency: EUR, paidBy: a }]
      - name: Umbrella
        costs: [{ amount: 0, currency: EUR, paidBy: c }]",
        ));
        assert_eq!(b.lines.len(), 2);
        let adapter = &b.lines[1];
        assert_eq!(
            (adapter.kind.as_str(), adapter.title.as_deref()),
            ("packing", Some("Adapter"))
        );
        assert!(adapter.committed);
        assert_eq!(adapter.shares.keys().collect::<Vec<_>>(), ["a", "c"]);
        assert_eq!(b.by_currency["EUR"].total.committed, dec("42"));
    }

    #[test]
    fn only_unsettled_payments_are_owed() {
        let b = compute(&trip(
            "      - { amount: 90, currency: EUR, paidBy: a }
      - { amount: 30, currency: EUR, paidBy: a, settled: false }
      - { amount: 60, currency: EUR, estimate: true }",
        ));
        let (paid_back, owed, unpaid) = (&b.lines[0], &b.lines[1], &b.lines[2]);
        assert!(paid_back.settled && !paid_back.unpaid);
        assert!(!owed.settled);
        assert!(unpaid.unpaid && unpaid.settled && unpaid.paid.is_empty());
        let eur = &b.by_currency["EUR"];
        assert_eq!(eur.total.planned, dec("180"));
        let a = eur.members.iter().find(|m| m.member == "a").unwrap();
        assert_eq!((a.paid.planned, a.balance), (dec("120"), dec("20")));
        assert_eq!(eur.settlements.len(), 2);
    }

    #[test]
    fn reservations_count_for_their_people() {
        let yaml = r"
apiVersion: taac/v1alpha4
kind: Trip
metadata: { title: T, timezone: UTC }
currency: { base: EUR }
members: [{ name: A }, { name: B }, { name: C }]
itinerary:
  - kind: activity
    title: x
    who: [everyone]
    date: 2027-01-01
    bookings:
      - { who: [a], status: booked, costs: [{ amount: 100, currency: EUR, paidBy: a }] }
      - { who: [b, c], status: required, costs: [{ amount: 50, currency: EUR }] }
";
        let files: Files = [("trip.yaml".to_owned(), yaml.to_owned())].into();
        let trip = load_standalone_trip(&files, "trip.yaml")
            .0
            .unwrap()
            .trips
            .remove(0);
        assert_eq!(
            trip.itinerary[0].booking.as_ref().unwrap().status,
            BookingStatus::Required
        );
        let b = compute(&trip);
        assert_eq!(b.lines[0].shares.keys().collect::<Vec<_>>(), ["a"]);
        assert!(b.lines[0].committed);
        assert_eq!(b.lines[1].shares.keys().collect::<Vec<_>>(), ["b", "c"]);
        assert!(!b.lines[1].committed);
        assert_eq!(b.by_currency["EUR"].total.committed, dec("100"));
    }
}
