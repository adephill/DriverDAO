(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-PROPOSAL-TITLE u101)
(define-constant ERR-INVALID-PROPOSAL-DESC u102)
(define-constant ERR-INVALID-DURATION u103)
(define-constant ERR-PROPOSAL-ALREADY-EXISTS u104)
(define-constant ERR-PROPOSAL-NOT-FOUND u105)
(define-constant ERR-VOTING-NOT-OPEN u106)
(define-constant ERR-ALREADY-VOTED u107)
(define-constant ERR-INSUFFICIENT-BALANCE u108)
(define-constant ERR-INVALID-AMOUNT u109)
(define-constant ERR-QUORUM-NOT-MET u110)
(define-constant ERR-TIMELOCK-ACTIVE u111)
(define-constant ERR-NOT-PASSED u112)
(define-constant ERR-ALREADY-EXECUTED u113)
(define-constant ERR-INVALID-QUORUM u114)
(define-constant ERR-INVALID-TIMELOCK u115)

(define-data-var next-proposal-id uint u0)
(define-data-var quorum-threshold uint u51)
(define-data-var timelock-duration uint u10)
(define-data-var total-voting-power uint u1000000)
(define-data-var authority-contract (optional principal) none)

(define-map proposals
  uint
  {
    title: (string-utf8 100),
    description: (string-utf8 200),
    yes-votes: uint,
    no-votes: uint,
    start-time: uint,
    end-time: uint,
    creator: principal,
    executed: bool,
    passed: (optional bool)
  }
)

(define-map votes
  {proposal: uint, voter: principal}
  {
    amount: uint,
    support: bool,
    timestamp: uint
  }
)

(define-read-only (get-proposal (id uint))
  (map-get? proposals id)
)

(define-read-only (get-vote (proposal-id uint) (voter principal))
  (map-get? votes {proposal: proposal-id, voter: voter})
)

(define-read-only (get-quorum-threshold)
  (var-get quorum-threshold)
)

(define-read-only (get-total-voting-power)
  (var-get total-voting-power)
)

(define-read-only (is-voting-open (proposal (map-entry uint 
  {
    title: (string-utf8 100),
    description: (string-utf8 200),
    yes-votes: uint,
    no-votes: uint,
    start-time: uint,
    end-time: uint,
    creator: principal,
    executed: bool,
    passed: (optional bool)
  }
)))
  (let (
    (current-time block-height)
    (start (get start-time proposal))
    (end (get end-time proposal))
  )
    (and (>= current-time start) (<= current-time end))
  )
)

(define-private (validate-title (title (string-utf8 100)))
  (if (and (> (len title) u0) (<= (len title) u100))
      (ok true)
      (err ERR-INVALID-PROPOSAL-TITLE))
)

(define-private (validate-description (desc (string-utf8 200)))
  (if (and (> (len desc) u0) (<= (len desc) u200))
      (ok true)
      (err ERR-INVALID-PROPOSAL-DESC))
)

(define-private (validate-duration (dur uint))
  (if (and (> dur u0) (<= dur u100))
      (ok true)
      (err ERR-INVALID-DURATION))
)

(define-private (validate-amount (amt uint))
  (if (> amt u0)
      (ok true)
      (err ERR-INVALID-AMOUNT))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-private (check-balance (voter principal) (amt uint))
  (if (>= (var-get total-voting-power) amt)
      (ok true)
      (err ERR-INSUFFICIENT-BALANCE))
)

(define-private (calculate-quorum (total-votes uint))
  (let (
    (threshold (* (var-get quorum-threshold) total-votes))
    (required (/ threshold u100))
  )
    (>= total-votes required)
  )
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-quorum-threshold (new-threshold uint))
  (begin
    (asserts! (and (> new-threshold u0) (<= new-threshold u100)) (err ERR-INVALID-QUORUM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set quorum-threshold new-threshold)
    (ok true)
  )
)

(define-public (set-timelock-duration (new-duration uint))
  (begin
    (asserts! (> new-duration u0) (err ERR-INVALID-TIMELOCK))
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set timelock-duration new-duration)
    (ok true)
  )
)

(define-public (create-proposal
  (title (string-utf8 100))
  (description (string-utf8 200))
  (duration uint)
)
  (let (
        (next-id (var-get next-proposal-id))
        (authority (var-get authority-contract))
      )
    (try! (validate-title title))
    (try! (validate-description description))
    (try! (validate-duration duration))
    (asserts! (is-none (map-get? proposals next-id)) (err ERR-PROPOSAL-ALREADY-EXISTS))
    (asserts! (is-some authority) (err ERR-NOT-AUTHORIZED))
    (map-set proposals next-id
      {
        title: title,
        description: description,
        yes-votes: u0,
        no-votes: u0,
        start-time: block-height,
        end-time: (+ block-height duration),
        creator: tx-sender,
        executed: false,
        passed: none
      }
    )
    (var-set next-proposal-id (+ next-id u1))
    (print { event: "proposal-created", id: next-id })
    (ok next-id)
  )
)

(define-public (vote
  (proposal-id uint)
  (amount uint)
  (support bool)
)
  (let (
        (proposal-opt (map-get? proposals proposal-id))
        (existing-vote (map-get? votes {proposal: proposal-id, voter: tx-sender}))
      )
    (match proposal-opt
      proposal
        (begin
          (asserts! (is-voting-open proposal) (err ERR-VOTING-NOT-OPEN))
          (asserts! (is-none existing-vote) (err ERR-ALREADY-VOTED))
          (try! (validate-amount amount))
          (try! (check-balance tx-sender amount))
          (let (
                (new-yes (if support (+ (get yes-votes proposal) amount) (get yes-votes proposal)))
                (new-no (if (not support) (+ (get no-votes proposal) amount) (get no-votes proposal)))
              )
            (map-set proposals proposal-id
              {
                title: (get title proposal),
                description: (get description proposal),
                yes-votes: new-yes,
                no-votes: new-no,
                start-time: (get start-time proposal),
                end-time: (get end-time proposal),
                creator: (get creator proposal),
                executed: (get executed proposal),
                passed: (get passed proposal)
              }
            )
            (map-set votes {proposal: proposal-id, voter: tx-sender}
              {
                amount: amount,
                support: support,
                timestamp: block-height
              }
            )
            (print { event: "vote-cast", proposal: proposal-id, voter: tx-sender, support: support, amount: amount })
            (ok true)
          )
        )
      (err ERR-PROPOSAL-NOT-FOUND)
    )
  )
)

(define-public (execute-proposal (proposal-id uint))
  (let (
        (proposal-opt (map-get? proposals proposal-id))
      )
    (match proposal-opt
      proposal
        (begin
          (asserts! (not (get executed proposal)) (err ERR-ALREADY-EXECUTED))
          (let (
                (current-time block-height)
                (end-time (get end-time proposal))
                (timelock-end (+ end-time (var-get timelock-duration)))
                (total-votes (+ (get yes-votes proposal) (get no-votes proposal)))
                (yes-percent (* u100 (get yes-votes proposal) u100 (/ total-votes u100)))
                (quorum-met (calculate-quorum total-votes))
                (passed (and quorum-met (>= yes-percent u51)))
              )
            (asserts! (>= current-time timelock-end) (err ERR-TIMELOCK-ACTIVE))
            (asserts! quorum-met (err ERR-QUORUM-NOT-MET))
            (asserts! passed (err ERR-NOT-PASSED))
            (map-set proposals proposal-id
              {
                title: (get title proposal),
                description: (get description proposal),
                yes-votes: (get yes-votes proposal),
                no-votes: (get no-votes proposal),
                start-time: (get start-time proposal),
                end-time: (get end-time proposal),
                creator: (get creator proposal),
                executed: true,
                passed: (some passed)
              }
            )
            (print { event: "proposal-executed", id: proposal-id, passed: passed })
            (ok true)
          )
        )
      (err ERR-PROPOSAL-NOT-FOUND)
    )
  )
)

(define-public (get-proposal-count)
  (ok (var-get next-proposal-id))
)