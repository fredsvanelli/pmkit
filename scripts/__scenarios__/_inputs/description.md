The webhook delivery worker drops a delivery when the receiver answers with a 5xx status.

The log shows `delivery failed: 503` and no retry follows.
