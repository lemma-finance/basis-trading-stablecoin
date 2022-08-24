// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;


import "forge-std/Test.sol";

interface AggregatorInterface {
  function latestAnswer() external view returns (int256);
  function latestTimestamp() external view returns (uint256);
  function latestRound() external view returns (uint256);
  function getAnswer(uint256 roundId) external view returns (int256);
  function getTimestamp(uint256 roundId) external view returns (uint256);

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
  event NewRound(uint256 indexed roundId, address indexed startedBy, uint256 startedAt);
}

interface AggregatorV3Interface {

  function decimals() external view returns (uint8);
  function description() external view returns (string memory);
  function version() external view returns (uint256);

  // getRoundData and latestRoundData should both raise "No data present"
  // if they do not have data to report, instead of returning unset values
  // which could be misinterpreted as actual reported values.
  function getRoundData(uint80 _roundId)
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );

}

interface AggregatorV2V3Interface is AggregatorInterface, AggregatorV3Interface
{
}

struct oracleData {
      uint80 roundId;
      int256 answer;
      uint256 startedAt;
      uint256 updatedAt;
      uint80 answeredInRound;
}

/**
 * @title A trusted proxy for updating where current answers are read from
 * @notice This contract provides a consistent address for the
 * CurrentAnwerInterface but delegates where it reads from to the owner, who is
 * trusted to update it.
 */
contract MockAggregatorProxy is AggregatorV2V3Interface {

    // NOTE: Real Aggregator Address 0x13e3ee699d1909e989722e753853ae30b17e08c5
    address public realAggregator;

    oracleData public overrideOracleData;
    bool public enableOverride;


    function setRealAggregator(address _realAggregator) external {
        realAggregator = _realAggregator;
    }

    function setEnableOverride(bool _enableOverride) external {
        enableOverride = _enableOverride;
    }


    function decimals() external view override returns (uint8) {
        return AggregatorV2V3Interface(realAggregator).decimals(); 
    }

    function description() external view override returns (string memory) {
        return AggregatorV2V3Interface(realAggregator).description(); 
    }

    function version() external view override returns (uint256) {
        return AggregatorV2V3Interface(realAggregator).version(); 
    }

    function latestAnswer() external view override returns (int256) {
        return AggregatorV2V3Interface(realAggregator).latestAnswer();
    }

    function latestTimestamp() external view override returns (uint256) {
        return AggregatorV2V3Interface(realAggregator).latestTimestamp();
    }


    function latestRound() external view override returns (uint256) {
        return AggregatorV2V3Interface(realAggregator).latestRound();
    }

    function getAnswer(uint256 roundId) external view override returns (int256) {
        return AggregatorV2V3Interface(realAggregator).getAnswer(roundId);
    }



    function getTimestamp(uint256 roundId) external view override returns (uint256) {
        return AggregatorV2V3Interface(realAggregator).getTimestamp(roundId);
    }


    function getRoundData(uint80 _roundId)
    external
    view 
    override
    returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        if(!enableOverride) {
            return AggregatorV2V3Interface(realAggregator).getRoundData(_roundId);
        } else {
            return (overrideOracleData.roundId, overrideOracleData.answer, overrideOracleData.startedAt, overrideOracleData.updatedAt, overrideOracleData.answeredInRound);
        }
    }


    function latestRoundData()
    external
    view
    override 
    returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        if(!enableOverride) {
            return AggregatorV2V3Interface(realAggregator).latestRoundData();
        } else {
            return (overrideOracleData.roundId, overrideOracleData.answer, overrideOracleData.startedAt, overrideOracleData.updatedAt, overrideOracleData.answeredInRound);
        }
    }


}

