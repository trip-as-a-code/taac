# Writing a Trip

A trip is one YAML file, or a directory of them (see [Splitting a Trip](#splitting-a-trip)). This page goes through it
section by section; [`examples/demo`](../examples/demo) has a complete one, and [`schema/`](../schema) has the JSON
Schema with every field.

## Metadata, People and Groups

```yaml
apiVersion: taac/v1alpha4
kind: Trip
metadata:
  title: Lisbon Long Weekend
  locale: en # the language the trip itself is written in
  timezone: Europe/Lisbon
  cover: { emoji: 🚋, hue: 28 }
currency:
  base: EUR # totals are in it; viewers can switch, converted at the ECB's daily rates
members:
  - { name: Alex }
  - { name: Sam, currency: GBP } # the money Sam pays with
  - { name: Robin, github: robin, role: viewer } # signs in as @robin; looks and comments, doesn't tick
groups:
  - { name: Early birds, emoji: 🌅, members: [Alex] }
  - { members: [Sam, Robin] } # without a name it shows as "Sam & Robin"
```

The title also makes the trip's URL: `Lisbon Long Weekend` lives at `/trips/lisbon-long-weekend/`, so two trips on one
site need different titles.

A member's `github` (or a github.com link in their `links`) is how they sign in on a site that requires it; their
`role` is `member` (everything, the default) or `viewer` (looks and comments). Groups are saved sets of people that
plans can name instead of listing everyone, and that split days show side by side.

## Places

```yaml
places:
  Lisbon: { geo: [38.7223, -9.1393], radius: 12000 } # an area, with a radius in metres
  London Gatwick: { geo: [51.1537, -0.1821], category: airport }
  Lisbon Airport: { geo: [38.7742, -9.1342], category: airport }
  Cais do Sodré: { geo: [38.7058, -9.1445], category: station }
  Belém: { geo: [38.6975, -9.2032] }
  Castelo de São Jorge:
    geo: [38.7139, -9.1335]
    category: historic
    photo: https://example.org/castelo.jpg # any https image; the server resizes it
```

Everything else refers to a place by its name. Places with a `radius` are areas, which bases, passes and ideas use.
Flights, trains, buses and ferries board at stations, stops, ports and airports only, so give those a `category`.

## The Itinerary

```yaml
itinerary:
  - kind: activity
    title: Tram 28 and the castle
    who: [Early birds, Sam]
    start: 2027-05-14T12:00:00+01:00 # always with the local offset
    end: 2027-05-14T16:00:00+01:00
    places: [Castelo de São Jorge]
    notes: Markdown is **fine** here.
  - kind: activity
    title: Sunset at a miradouro
    who: [everyone]
    date: 2027-05-14 # a day without a fixed time
    part: evening # morning, afternoon or evening
```

A plan's `kind` is one of `flight`, `train`, `bus`, `ferry`, `transfer`, `walk`, `ride`, `lodging`, `activity`, `meal`,
`note` or `free`. `who` takes members, groups or `everyone`, and a plan without it is flagged, since it's usually a
mistake. Plans are timed with `start` and `end`, or with a `date` and an optional `part` of the day.

### Getting Around

Every move between two different places needs a way there, so taac can tell when someone would have to teleport:

```yaml
- kind: flight
  title: London → Lisbon
  who: [everyone]
  start: 2027-05-14T07:05:00+01:00
  end: 2027-05-14T09:50:00+01:00
  places: [London Gatwick, Lisbon Airport] # from, to
  transport: { carrier: TAP Air Portugal, number: TP1337 }
- kind: ride # or walk, bus, train: a short leg is still a leg
  title: Bike to Belém
  who: [everyone]
  start: 2027-05-15T09:15:00+01:00
  end: 2027-05-15T09:50:00+01:00
  places: [Cais do Sodré, Belém]
  transport: { vehicle: bicycle, carrier: GIRA } # bicycle or scooter; a rental is its carrier
```

### Free Time

```yaml
- kind: free
  who: [everyone]
  start: 2027-05-15T10:00:00+01:00
  end: 2027-05-15T15:00:00+01:00
  places: [Belém] # optional
```

Time left to decide on the spot. Its title is optional ("Free time" in the trip's language), it's never booked or paid
for, and the itinerary lists the ideas around it and those proposed within it. Getting to free time somewhere still
needs a way there; moving on from it doesn't.

## Bookings

```yaml
booking:
  status: required # or booked; leave booking out when there's nothing to book
  opens: 2027-04-14T09:00:00+01:00 # optional: sales open then (a date works too)
  deadline: 2027-05-01
  provider: Castelo de São Jorge
  url: https://example.org/tickets
  reference: { secret: CASTLE_BOOKING } # booked: the confirmation number, never published
```

A booking still to make shows on the bookings page by its deadline, and its people get reminders as it nears. If sales
open later, the plan says when, and the reminders wait until then.

Booked separately by different people? Use `bookings:` instead, a list of reservations, each with its own `who`,
`status`, `reference`, `deadline` and costs. A return flight in the same booking as the outbound gets the same
`reference` and no costs of its own.

### Lotteries

Some things aren't sold but drawn: a ballot for event tickets, a lottery for a restaurant table, a general sale only
for whatever is left. Mark the booking with `lottery`:

```yaml
booking:
  status: required # booked once you've won
  opens: 2027-04-01T13:00:00+01:00 # entries open
  deadline: 2027-04-14 # last day to enter
  lottery:
    results: 2027-04-18 # when the draw comes out
    each: true # everyone enters for themselves
```

Until it's won, the card says when the results come out, with a button to tick that you've entered (one per person
with `each`). Its people get a reminder every day from when entries open until they've ticked, then one on the results
day.

A second chance, such as a general sale after the draw, is an idea in the same [choice](#ideas) as the plan, with its
own `opens`. While the draw is undecided, the choice stays open and the fallback keeps its reminders; once the plan's
booking is `booked`, the choice is settled and the fallback goes quiet.

## Money

```yaml
costs:
  - { amount: 138, currency: GBP, paidBy: Sam }
  - { amount: 60, currency: EUR, estimate: true } # a guess, nobody has paid yet
```

A cost is split equally between the plan's people unless `split` says otherwise (`personal`, `{ shares: … }` or
`{ exact: … }`). Without `paidBy` it isn't paid yet; `paidBy: each` means everyone paid their own part. A few more:

- `charged: { amount: 152.4, currency: EUR }`: what actually left the payer's account, when they paid in another currency.
- `owedBy: Sam`: one person pays the payer back for everyone's share, say for their partner too.
- `due: 2027-05-10`: booked at this price but charged later; until `charged` is added, it reminds whoever pays.
- `settled: false`: someone still owes the payer, even though it's paid.

The budget page adds it all up per person and works out who owes whom, opening each debt to the expenses behind it.
`spending` on the trip sets budgets for buying on the spot (groceries, souvenirs), which count as planned spend.

## Bases

```yaml
bases:
  - { title: Lisbon, place: Lisbon, from: 2027-05-14, to: 2027-05-16 }
```

Where everyone is each night, planned in detail or not; `to` is the last night there. Without `bases`, they're derived
from lodging. Free days at a base suggest ideas nearby.

## Passes

```yaml
passes:
  - title: Viva Viagem day passes
    area: Lisbon
    periods: [{ from: 2027-05-14, to: 2027-05-17 }]
    mode: transit # transit (the default), bicycle or scooter
    provider: Carris / Metro de Lisboa
    costs: [{ amount: 84, currency: EUR, paidBy: each, estimate: true }]
```

A ticket or rental that pays for the legs in an area. Each move is still a leg of its own. Held per party, a pass takes
`bookings:` like a plan's reservations, each with its own `who`, `periods` and costs.

## Blockers

```yaml
blockers:
  - title: Work
    who: [Alex]
    periods: [{ from: 2027-05-14, to: 2027-05-17 }]
    days: [mon, tue, wed, thu, fri] # leave out for every day
    time: { start: '09:00', end: '17:00', timezone: Europe/London } # leave out for whole days
```

Time someone isn't available. Plans inside it are flagged; `strict: true` makes that an error, and a plan that's fine
anyway says so with `overrides: [Work]`.

## Tasks

```yaml
tasks:
  - title: Get a visa
    who: [Robin]
    required: true # the trip can't go ahead without it, so it's due by the start
    due: 2027-04-01
    done: 2027-03-20 # or leave it out and tick it on the site
  - title: Fill in the arrival form
    who: [everyone]
    each: true # everyone does it for themselves, and ticks their own
```

What has to get done before, during or after the trip. Open tasks remind their people as they come due.

## Ideas

```yaml
ideas:
  - title: Fado night in Alfama
    who: [everyone]
    area: Lisbon
    priority: must # or maybe, the default
    duration: hour # hour, halfDay or day
    costs: [{ amount: 60, currency: EUR, estimate: true }]
  - title: Pestana Palace
    kind: lodging
    who: [Early birds]
    start: 2027-05-16T15:00:00+01:00
    end: 2027-05-17T11:00:00+01:00
    booking: { status: required, deadline: 2027-05-01 }
    costs: [{ amount: 240, currency: EUR, estimate: true }]
```

Anything that could become a plan, never booked or paid for yet. An undated idea is suggested on free days nearby; a
dated one shows on its day as a proposal.

When a few ideas are alternatives for the same thing, name the choice and point them at it:

```yaml
choices:
  - name: Fado dinner # pick: 2 when two of them get done
ideas:
  - { title: Fado at Clube de Fado, choice: Fado dinner, who: [everyone], date: 2027-05-16, part: evening }
  - { title: Fado at Tasca do Chico, choice: Fado dinner, who: [everyone], date: 2027-05-16, part: evening }
```

They're compared side by side, only the cheapest ones the choice picks count towards possible spend, and a plan that
names the choice settles it.

## Packing

```yaml
packing:
  - category: Essentials
    items: [Passport, { name: Camera, who: [Sam] }, { name: T-shirts, qty: 4, bag: suitcase }]
```

Ticks on the site are shared, so everyone sees what's packed. An item can carry `costs` and a `bought` flag for things
to buy first.

## Names Instead of Ids

Nothing needs an id. People, groups, places and blockers are referred to by name, in any case; plans, ideas and bases
are identified by their titles. The copy-link button on a card follows its title, so renaming a plan changes its link.

## Splitting a Trip

A trip can be a directory: one `kind: Trip` file plus any number of `kind: TripPart` files (places, bases, itinerary
chunks, ideas, packing) merged into it. Several people editing at once get fewer merge conflicts that way.

## Secrets

Booking references, phone numbers and anything else confidential are written as `{ secret: NAME }`. The value comes
from `.env`, `secrets.yaml` or the environment, and only `taac build --reveal` (see [Command Line](cli.md)) ever fills
it in, on your own machine. The website only learns that a value exists, never what it is.

## Validation

Beyond the schema, `taac validate` checks references, time zones, that things end after they start, overlapping plans
per person (people on different tracks don't clash, and a flat kept while away isn't slept in), overlapping bases,
nights nobody accounted for, moves with no way there, currencies with rates, splits that add up, and inline `${…}` that
would leak.
