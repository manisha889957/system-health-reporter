from flask import Flask, render_template, jsonify, request

import health_collector

app = Flask(__name__)


def get_process_count_from_request():
    how_many = request.args.get("top", default=5, type=int)
    if how_many < 1:
        how_many = 1
    if how_many > 20:
        how_many = 20
    return how_many


@app.route("/")
def show_dashboard():
    report = health_collector.collect_full_report()
    return render_template("dashboard.html", report=report)


@app.route("/api/health")
def api_health():
    report = health_collector.collect_full_report(get_process_count_from_request())
    return jsonify(report)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)