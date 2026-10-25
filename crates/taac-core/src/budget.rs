//! Who paid what, who owes whom. Everything is converted to the base
//! currency; per-currency totals are kept alongside for display.

use indexmap::IndexMap;
use rust_decimal::{Decimal, RoundingStrategy};
use serde::Serialize;

use crate::loader::Trip;
use crate::model::{BookingStatus, Item, Split};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    pub base: String,
    pub total: Amounts,
    pub by_currency: IndexMap<String, Amounts>,
    pub by_kind: IndexMap<String, Amounts>,
    pub members: Vec<MemberBalance>,
    /// Transfers that settle every balance, planned spend included.
    pub settlements: Vec<Settlement>,
    pub lines: Vec<CostLine>,
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
    /// `paid - share`: positive is owed money, negative owes.
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostLine {
    pub item: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(with = "rust_decimal::serde::float")]
    pub amount: Decimal,
    pub currency: String,
    #[serde(with = "rust_decimal::serde::float")]
    pub base_amount: Decimal,
    pub paid_by: String,
    pub committed: bool,
    /// Base-currency share per member.
    #[serde(serialize_with = "float_map")]
    pub shares: IndexMap<String, Decimal>,
}

fn float_map<S: serde::Serializer>(
    map: &IndexMap<String, Decimal>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use rust_decimal::prelude::ToPrimitive;
    use serde::ser::SerializeMap;
    let mut out = serializer.serialize_map(Some(map.len()))?;
    for (k, v) in map {
        out.serialize_entry(k, &v.to_f64().unwrap_or_default())?;
    }
    out.end()
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
    let total_weight: Decimal = weights.iter().map(|(_, w)| *w).sum();
    let mut out = IndexMap::new();
    if total_weight <= Decimal::ZERO {
        out.insert(paid_by.to_owned(), round(amount));
        return out;
    }
    let target = round(amount);
    let mut allocated = Decimal::ZERO;
    for (member, weight) in &weights {
        let share =
            (amount * weight / total_weight).round_dp_with_strategy(2, RoundingStrategy::ToZero);
        allocated += share;
        *out.entry(member.clone()).or_insert(Decimal::ZERO) += share;
    }
    // Hand leftover cents out one by one, first participants first.
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

pub fn compute(trip: &Trip) -> Budget {
    let base = trip.base_currency().to_owned();
    let mut budget = Budget {
        base: base.clone(),
        total: Amounts::default(),
        by_currency: IndexMap::new(),
        by_kind: IndexMap::new(),
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
        lines: Vec::new(),
    };

    for item in &trip.itinerary {
        if is_cancelled(item) {
            continue;
        }
        let committed = is_committed(item);
        let participants = trip.participants(item);
        for cost in &item.costs {
            let Some(base_amount) = trip
                .currency
                .as_ref()
                .and_then(|c| c.to_base(cost.amount, &cost.currency))
                .map(round)
            else {
                continue;
            };
            let split = match &cost.split {
                // Exact amounts are in the cost's currency; convert per member.
                Split::Exact(map) => Split::Shares(map.clone()),
                other => other.clone(),
            };
            let shares = shares(base_amount, &split, &cost.paid_by, &participants);

            budget.total.add(base_amount, committed);
            budget
                .by_currency
                .entry(cost.currency.clone())
                .or_default()
                .add(cost.amount, committed);
            budget
                .by_kind
                .entry(item.kind.as_str().to_owned())
                .or_default()
                .add(base_amount, committed);
            for balance in &mut budget.members {
                if balance.member == cost.paid_by {
                    balance.paid.add(base_amount, committed);
                }
                if let Some(share) = shares.get(&balance.member) {
                    balance.share.add(*share, committed);
                }
            }
            budget.lines.push(CostLine {
                item: item.id.clone(),
                label: cost.label.clone(),
                amount: cost.amount,
                currency: cost.currency.clone(),
                base_amount,
                paid_by: cost.paid_by.clone(),
                committed,
                shares,
            });
        }
    }

    for balance in &mut budget.members {
        balance.balance = balance.paid.planned - balance.share.planned;
    }
    budget.settlements = settle(&budget.members);
    budget
}

/// Greedy: the largest debtor pays the largest creditor until all are even.
fn settle(balances: &[MemberBalance]) -> Vec<Settlement> {
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
        if amount < Decimal::new(1, 2) {
            break;
        }
        out.push(Settlement {
            from: d.0.clone(),
            to: c.0.clone(),
            amount,
        });
        c.1 -= amount;
        d.1 -= amount;
        creditors.retain(|x| x.1 >= Decimal::new(1, 2));
        debtors.retain(|x| x.1 >= Decimal::new(1, 2));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
