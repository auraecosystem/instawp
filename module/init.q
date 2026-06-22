logi CoreReasoner {

    input: user_query

    step detect_intent {
        analyze user_query
        classify:
            question,
            command,
            code,
            blockchain,
            ai
    }

    step evaluate {
        if intent == question {
            action explain
        }

        if intent == command {
            action execute
        }

        if intent == code {
            action analyze_code
        }

        if intent == blockchain {
            action verify_chain
        }

        if intent == ai {
            action invoke_model
        }
    }

    output result
}
