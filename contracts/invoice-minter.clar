(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-INVOICE-HASH u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-INVALID-DUE-DATE u103)
(define-constant ERR-INVALID-BUYER u104)
(define-constant ERR-INVALID-ORACLE u105)
(define-constant ERR-INVOICE-ALREADY-EXISTS u106)
(define-constant ERR-INVOICE-NOT-FOUND u107)
(define-constant ERR-INVALID-TIMESTAMP u108)
(define-constant ERR-ORACLE-NOT-VERIFIED u109)
(define-constant ERR-INVALID-MIN-AMOUNT u110)
(define-constant ERR-INVALID-MAX-AMOUNT u111)
(define-constant ERR-INVOICE-UPDATE-NOT-ALLOWED u112)
(define-constant ERR-INVALID-UPDATE-PARAM u113)
(define-constant ERR-MAX-INVOICES-EXCEEDED u114)
(define-constant ERR-INVALID-INVOICE-STATUS u115)
(define-constant ERR-INVALID-INTEREST-RATE u116)
(define-constant ERR-INVALID-GRACE-PERIOD u117)
(define-constant ERR-INVALID-LOCATION u118)
(define-constant ERR-INVALID-CURRENCY u119)
(define-constant ERR-INVALID-TOKEN-ID u120)

(define-data-var next-invoice-id uint u0)
(define-data-var max-invoices uint u10000)
(define-data-var mint-fee uint u500)
(define-data-var oracle-contract (optional principal) none)

(define-map invoices
  uint
  {
    hash: (string-ascii 32),
    amount: uint,
    due-date: uint,
    buyer: principal,
    timestamp: uint,
    minter: principal,
    status: bool,
    interest-rate: uint,
    grace-period: uint,
    location: (string-utf8 100),
    currency: (string-utf8 20),
    min-amount: uint,
    max-amount: uint
  }
)

(define-map invoices-by-hash
  (string-ascii 32)
  uint)

(define-map invoice-updates
  uint
  {
    update-hash: (string-ascii 32),
    update-amount: uint,
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-invoice (id uint))
  (map-get? invoices id)
)

(define-read-only (get-invoice-updates (id uint))
  (map-get? invoice-updates id)
)

(define-read-only (is-invoice-registered (hash (string-ascii 32)))
  (is-some (map-get? invoices-by-hash hash))
)

(define-private (validate-hash (hash (string-ascii 32)))
  (if (and (> (len hash) u0) (<= (len hash) u32))
      (ok true)
      (err ERR-INVALID-INVOICE-HASH))
)

(define-private (validate-amount (amount uint))
  (if (> amount u0)
      (ok true)
      (err ERR-INVALID-AMOUNT))
)

(define-private (validate-due-date (date uint))
  (if (> date block-height)
      (ok true)
      (err ERR-INVALID-DUE-DATE))
)

(define-private (validate-buyer (buyer principal))
  (if (not (is-eq buyer tx-sender))
      (ok true)
      (err ERR-INVALID-BUYER))
)

(define-private (validate-interest-rate (rate uint))
  (if (<= rate u20)
      (ok true)
      (err ERR-INVALID-INTEREST-RATE))
)

(define-private (validate-grace-period (period uint))
  (if (<= period u30)
      (ok true)
      (err ERR-INVALID-GRACE-PERIOD))
)

(define-private (validate-location (loc (string-utf8 100)))
  (if (and (> (len loc) u0) (<= (len loc) u100))
      (ok true)
      (err ERR-INVALID-LOCATION))
)

(define-private (validate-currency (cur (string-utf8 20)))
  (if (or (is-eq cur u"STX") (is-eq cur u"USD") (is-eq cur u"BTC"))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)

(define-private (validate-min-amount (min uint))
  (if (> min u0)
      (ok true)
      (err ERR-INVALID-MIN-AMOUNT))
)

(define-private (validate-max-amount (max uint))
  (if (> max u0)
      (ok true)
      (err ERR-INVALID-MAX-AMOUNT))
)

(define-private (validate-oracle (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-ORACLE-NOT-VERIFIED))
)

(define-public (set-oracle-contract (contract-principal principal))
  (begin
    (try! (validate-oracle contract-principal))
    (asserts! (is-none (var-get oracle-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (var-set oracle-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-invoices (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-MAX-INVOICES-EXCEEDED))
    (asserts! (is-some (var-get oracle-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (var-set max-invoices new-max)
    (ok true)
  )
)

(define-public (set-mint-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get oracle-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (var-set mint-fee new-fee)
    (ok true)
  )
)

(define-public (mint-invoice
  (invoice-hash (string-ascii 32))
  (amount uint)
  (due-date uint)
  (buyer principal)
  (interest-rate uint)
  (grace-period uint)
  (location (string-utf8 100))
  (currency (string-utf8 20))
  (min-amount uint)
  (max-amount uint)
)
  (let (
        (next-id (var-get next-invoice-id))
        (current-max (var-get max-invoices))
        (oracle (var-get oracle-contract))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-INVOICES-EXCEEDED))
    (try! (validate-hash invoice-hash))
    (try! (validate-amount amount))
    (try! (validate-due-date due-date))
    (try! (validate-buyer buyer))
    (try! (validate-interest-rate interest-rate))
    (try! (validate-grace-period grace-period))
    (try! (validate-location location))
    (try! (validate-currency currency))
    (try! (validate-min-amount min-amount))
    (try! (validate-max-amount max-amount))
    (asserts! (is-none (map-get? invoices-by-hash invoice-hash)) (err ERR-INVOICE-ALREADY-EXISTS))
    (let ((oracle-recipient (unwrap! oracle (err ERR-ORACLE-NOT-VERIFIED))))
      (try! (stx-transfer? (var-get mint-fee) tx-sender oracle-recipient))
    )
    (map-set invoices next-id
      {
        hash: invoice-hash,
        amount: amount,
        due-date: due-date,
        buyer: buyer,
        timestamp: block-height,
        minter: tx-sender,
        status: true,
        interest-rate: interest-rate,
        grace-period: grace-period,
        location: location,
        currency: currency,
        min-amount: min-amount,
        max-amount: max-amount
      }
    )
    (map-set invoices-by-hash invoice-hash next-id)
    (var-set next-invoice-id (+ next-id u1))
    (print { event: "invoice-minted", id: next-id })
    (ok next-id)
  )
)

(define-public (burn-invoice (invoice-id uint) (burn-amount uint))
  (let ((invoice (map-get? invoices invoice-id)))
    (match invoice
      inv
        (begin
          (asserts! (is-eq (get minter inv) tx-sender) (err ERR-NOT-AUTHORIZED))
          (try! (validate-amount burn-amount))
          (asserts! (<= burn-amount (get amount inv)) (err ERR-INVALID-AMOUNT))
          (map-set invoices invoice-id
            (merge inv { amount: (- (get amount inv) burn-amount), status: (if (is-eq (- (get amount inv) burn-amount) u0) false true) })
          )
          (print { event: "invoice-burned", id: invoice-id, amount: burn-amount })
          (ok true)
        )
      (err ERR-INVOICE-NOT-FOUND)
    )
  )
)

(define-public (update-invoice
  (invoice-id uint)
  (update-hash (string-ascii 32))
  (update-amount uint)
)
  (let ((invoice (map-get? invoices invoice-id)))
    (match invoice
      inv
        (begin
          (asserts! (is-eq (get minter inv) tx-sender) (err ERR-NOT-AUTHORIZED))
          (try! (validate-hash update-hash))
          (try! (validate-amount update-amount))
          (let ((existing (map-get? invoices-by-hash update-hash)))
            (match existing
              existing-id
                (asserts! (is-eq existing-id invoice-id) (err ERR-INVOICE-ALREADY-EXISTS))
              (begin true)
            )
          )
          (let ((old-hash (get hash inv)))
            (if (is-eq old-hash update-hash)
                (ok true)
                (begin
                  (map-delete invoices-by-hash old-hash)
                  (map-set invoices-by-hash update-hash invoice-id)
                  (ok true)
                )
            )
          )
          (map-set invoices invoice-id
            (merge inv
              {
                hash: update-hash,
                amount: update-amount,
                timestamp: block-height
              }
            )
          )
          (map-set invoice-updates invoice-id
            {
              update-hash: update-hash,
              update-amount: update-amount,
              update-timestamp: block-height,
              updater: tx-sender
            }
          )
          (print { event: "invoice-updated", id: invoice-id })
          (ok true)
        )
      (err ERR-INVOICE-NOT-FOUND)
    )
  )
)

(define-public (get-invoice-count)
  (ok (var-get next-invoice-id))
)

(define-public (check-invoice-existence (hash (string-ascii 32)))
  (ok (is-invoice-registered hash))
)